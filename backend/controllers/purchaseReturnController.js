const mongoose = require('mongoose');
const PurchaseReturn = require('../models/PurchaseReturn');
const GoodsReceipt = require('../models/GoodsReceipt');
const PurchaseOrder = require('../models/PurchaseOrder');
const PurchaseInvoice = require('../models/PurchaseInvoice');
const Vendor = require('../models/Vendor');
const { hasPermission } = require('../config/permissions');
const { successResponse, errorResponse } = require('../helpers/responseHelper');
const audit = require('../helpers/auditLogger');
const { runInTransaction, HttpError, lock, ref } = require('../helpers/transaction');
const { applyMovements, nextDocNo } = require('../helpers/stockHelper');
const { checkAmount, round2 } = require('../helpers/number');
const { lineSubtotal, receiptStatus } = require('../helpers/purchaseHelper');
const { invoiceBalance } = require('../helpers/salesHelper');
const { assertGudang, applyGudangFilter } = require('../helpers/gudangAccess');

/**
 * Retur pembelian (lihat models/PurchaseReturn.js). Izin purchaseReturn: create/update/delete = draft,
 * post = posting & pembatalan (stok keluar / kembali). Nilai & HPP hanya untuk vendorPrice:view.
 */
const RESOLUTIONS = ['CREDIT', 'REPLACE'];
const SORTABLE_FIELDS = ['no', 'date', 'total', 'createdDate', 'updatedDate'];

const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status);
  if (error.name === 'ValidationError' || error.name === 'CastError') return errorResponse(res, error.message, 400);
  return errorResponse(res, error.message, 500);
};
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const trimText = (v, max = 500) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));
const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const canSeeCostOf = (req) => hasPermission(req.user, 'vendorPrice', 'view');
const returnable = (l) => Math.max(round2(l.qty - (l.qtyReturned || 0)), 0);

const stripCost = (req, doc) => {
  doc.canSeeCost = canSeeCostOf(req);
  if (doc.canSeeCost) return doc;
  delete doc.total;
  (doc.lines || []).forEach((l) => { delete l.unitCost; delete l.amount; });
  return doc;
};

/** Validasi body (murni): { goodsReceipt, date, reason, resolution, note, lines: [{ poLine, qty, note }] } */
const parseReturn = (body) => {
  const date = body.date ? new Date(body.date) : new Date();
  if (Number.isNaN(date.getTime())) throw new HttpError('Invalid return date', 400);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  if (date > endOfToday) throw new HttpError('Return date cannot be in the future', 400);
  const reason = trimText(body.reason);
  if (!reason) throw new HttpError('Return reason is required', 400);
  const resolution = body.resolution === undefined || body.resolution === null ? 'CREDIT' : body.resolution;
  if (!RESOLUTIONS.includes(resolution)) throw new HttpError('Invalid resolution', 400);
  const input = (Array.isArray(body.lines) ? body.lines : []).filter((l) => Number(l?.qty) !== 0);
  if (!input.length) throw new HttpError('Fill in the returned quantity for at least one item', 400);
  const seen = new Set();
  const lines = input.map((l, i) => {
    const n = `Line ${i + 1}`;
    if (!mongoose.isValidObjectId(l?.poLine)) throw new HttpError(`${n}: invalid line`, 400);
    if (seen.has(String(l.poLine))) throw new HttpError(`${n}: the same line appears more than once`, 400);
    seen.add(String(l.poLine));
    const err = checkAmount(l.qty, 'Returned quantity', { min: 0, exclusive: true });
    if (err) throw new HttpError(`${n}: ${err}`, 400);
    return { poLine: String(l.poLine), qty: round2(l.qty), note: trimText(l.note, 200) || undefined };
  });
  return { date, reason, resolution, note: trimText(body.note), lines };
};

/** GR POSTED yang bisa diretur (dikunci) */
const loadGr = async (req, id) => {
  if (!mongoose.isValidObjectId(id)) throw new HttpError('Please select a goods receipt', 400);
  await lock(ref('goodsReceipt', id));
  const gr = await GoodsReceipt.findById(id);
  if (!gr) throw new HttpError('Goods receipt not found', 404);
  assertGudang(req, gr.gudang);
  if (gr.status !== 'POSTED') throw new HttpError(`${gr.no} is not posted and cannot be returned`, 400);
  return gr;
};

/** Baris retur lengkap dari baris GR + PO (qty <= bisa diretur; nilai = harga PO + PPN) */
const buildLines = async (gr, po, parsedLines) => {
  const codes = new Map((await mongoose.model('ProdukSku').find({ _id: { $in: gr.lines.map((l) => l.sku) } }).select('sku').lean())
    .map((s) => [String(s._id), s.sku]));
  return parsedLines.map((l) => {
    const gl = gr.lines.find((x) => String(x.poLine) === l.poLine);
    if (!gl) throw new HttpError('One or more lines do not belong to this goods receipt', 400);
    const max = returnable(gl);
    if (l.qty > max) throw new HttpError(`${codes.get(String(gl.sku)) || 'Item'}: return ${fmt(l.qty)} exceeds the returnable quantity ${fmt(max)}`, 400);
    const pl = po?.lines.find((x) => String(x._id) === l.poLine);
    const amount = pl ? round2(lineSubtotal({ qty: l.qty, hargaBeli: pl.hargaBeli, diskonPersen: pl.diskonPersen || 0 }) * (1 + (po.taxRate || 0) / 100)) : 0;
    return {
      poLine: gl.poLine, sku: gl.sku, produk: gl.produk, uomBeli: gl.uomBeli, konversi: gl.konversi,
      qty: l.qty, qtyBase: round2(l.qty * gl.konversi), unitCost: gl.unitCost, amount, note: l.note,
    };
  });
};

const populateReturn = (q) => q
  .populate('goodsReceipt', 'no date purchaseInvoice')
  .populate('purchaseOrder', 'no status')
  .populate('vendor', 'companyName')
  .populate('gudang', 'code name')
  .populate('purchaseInvoice', 'no status')
  .populate('lines.sku', 'sku variantValues')
  .populate({ path: 'lines.produk', select: 'name uom', populate: { path: 'uom', select: 'code' } })
  .populate('lines.uomBeli', 'code')
  .populate('createdBy', 'name')
  .populate('updatedBy', 'name')
  .populate('postedBy', 'name')
  .populate('cancelledBy', 'name');

// ---------------------------------------------------------------- baca

/** GET /api/purchase-return — filter search (no / GR / vendor / alasan), status, vendor, goodsReceipt, gudang, from, to */
exports.getReturns = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || 1) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || 10) || 10, 1), 100);
    const sortField = SORTABLE_FIELDS.includes(req.query.sortField) ? req.query.sortField : 'createdDate';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const filter = {};
    if (req.query.gudang && !mongoose.isValidObjectId(req.query.gudang)) return errorResponse(res, 'Invalid warehouse', 400);
    applyGudangFilter(req, filter, req.query.gudang);
    if (['DRAFT', 'POSTED', 'CANCELLED'].includes(req.query.status)) filter.status = req.query.status;
    for (const key of ['vendor', 'goodsReceipt']) {
      if (!req.query[key]) continue;
      if (!mongoose.isValidObjectId(req.query[key])) return errorResponse(res, `Invalid ${key}`, 400);
      filter[key] = req.query[key];
    }
    if (req.query.from || req.query.to) {
      filter.date = {};
      if (req.query.from) filter.date.$gte = new Date(`${req.query.from}T00:00:00`);
      if (req.query.to) filter.date.$lte = new Date(`${req.query.to}T23:59:59.999`);
    }
    if (req.query.search) {
      const rx = { $regex: escapeRegex(req.query.search), $options: 'i' };
      const [vendors, grs] = await Promise.all([
        Vendor.find({ companyName: rx }).distinct('_id'),
        GoodsReceipt.find({ no: rx }).distinct('_id'),
      ]);
      filter.$or = [{ no: rx }, { reason: rx }, { note: rx }, { vendor: { $in: vendors } }, { goodsReceipt: { $in: grs } }];
    }
    const [totalData, rows] = await Promise.all([
      PurchaseReturn.countDocuments(filter),
      PurchaseReturn.find(filter)
        .populate('goodsReceipt', 'no').populate('vendor', 'companyName').populate('gudang', 'code')
        .populate('purchaseInvoice', 'no').populate('createdBy', 'name').populate('updatedBy', 'name')
        .sort({ [sortField]: sortOrder, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);
    rows.forEach((r) => {
      r.lineCount = r.lines.length;
      r.totalQty = round2(r.lines.reduce((s, l) => s + l.qtyBase, 0));
      delete r.lines;
      stripCost(req, r);
    });
    return successResponse(res, { dataPurchaseReturn: rows, totalData, currentPage: page, totalPages: Math.ceil(totalData / pageSize) });
  } catch (error) {
    return handleError(res, error);
  }
};

/** GET /api/purchase-return/gr-options?search= — GR POSTED yang masih punya qty bisa diretur */
exports.getGrOptions = async (req, res) => {
  try {
    const filter = applyGudangFilter(req, { status: 'POSTED' });
    filter.$expr = { $anyElementTrue: { $map: { input: '$lines', as: 'l', in: { $lt: [{ $ifNull: ['$$l.qtyReturned', 0] }, '$$l.qty'] } } } };
    if (req.query.search) {
      const rx = { $regex: escapeRegex(req.query.search), $options: 'i' };
      const vendors = await Vendor.find({ companyName: rx }).distinct('_id');
      filter.$or = [{ no: rx }, { deliveryNoteNo: rx }, { vendor: { $in: vendors } }];
    }
    const rows = await GoodsReceipt.find(filter).select('no date vendor gudang purchaseOrder purchaseInvoice')
      .populate('vendor', 'companyName').populate('gudang', 'code').populate('purchaseOrder', 'no')
      .sort({ date: -1 }).limit(20).lean();
    return successResponse(res, rows);
  } catch (error) {
    return handleError(res, error);
  }
};

/** GET /api/purchase-return/from-gr/:grId — baris GR + returnable (+ unitCost & nilai per unit bila boleh lihat biaya) */
exports.getGrForReturn = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.grId)) return errorResponse(res, 'Goods receipt not found', 404);
    const gr = await GoodsReceipt.findById(req.params.grId)
      .populate('vendor', 'companyName').populate('gudang', 'code name').populate('purchaseOrder', 'no status taxRate lines')
      .populate('purchaseInvoice', 'no status')
      .populate('lines.sku', 'sku variantValues')
      .populate({ path: 'lines.produk', select: 'name uom', populate: { path: 'uom', select: 'code' } })
      .populate('lines.uomBeli', 'code').lean();
    if (!gr) return errorResponse(res, 'Goods receipt not found', 404);
    assertGudang(req, gr.gudang?._id);
    const po = gr.purchaseOrder;
    const canSeeCost = canSeeCostOf(req);
    gr.lines.forEach((l) => {
      l.returnable = returnable(l);
      const pl = po?.lines.find((x) => String(x._id) === String(l.poLine));
      if (canSeeCost && pl) l.unitAmount = round2(lineSubtotal({ qty: 1, hargaBeli: pl.hargaBeli, diskonPersen: pl.diskonPersen || 0 }) * (1 + (po.taxRate || 0) / 100));
      if (!canSeeCost) { delete l.unitCost; delete l.baseUnitCost; delete l.freightCost; }
    });
    gr.purchaseOrder = po ? { _id: po._id, no: po.no, status: po.status } : null;
    gr.canSeeCost = canSeeCost;
    if (!canSeeCost) delete gr.freightCharge;
    return successResponse(res, gr);
  } catch (error) {
    return handleError(res, error);
  }
};

/** GET /api/purchase-return/:id — + returnable per baris (draft) */
exports.getReturn = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 'Purchase return not found', 404);
    const doc = await populateReturn(PurchaseReturn.findById(req.params.id)).lean();
    if (!doc) return errorResponse(res, 'Purchase return not found', 404);
    assertGudang(req, doc.gudang?._id);
    const gr = await GoodsReceipt.findById(doc.goodsReceipt?._id).select('lines').lean();
    const byLine = new Map((gr?.lines || []).map((l) => [String(l.poLine), l]));
    doc.lines.forEach((l) => {
      const gl = byLine.get(String(l.poLine));
      l.received = gl?.qty ?? null;
      l.returned = gl?.qtyReturned ?? null;
      l.returnable = gl ? returnable(gl) : null;
    });
    return successResponse(res, stripCost(req, doc));
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- draft

const loadDraft = async (req, id) => {
  if (!mongoose.isValidObjectId(id)) throw new HttpError('Purchase return not found', 404);
  const doc = await PurchaseReturn.findById(id);
  if (!doc) throw new HttpError('Purchase return not found', 404);
  assertGudang(req, doc.gudang);
  if (doc.status !== 'DRAFT') throw new HttpError(`Purchase return is already ${doc.status.toLowerCase()}`, 400);
  return doc;
};

/** POST /api/purchase-return  body: { goodsReceipt, date, reason, resolution, note, lines } */
exports.createReturn = async (req, res) => {
  try {
    const parsed = parseReturn(req.body);
    const doc = await runInTransaction(async () => {
      const gr = await loadGr(req, req.body.goodsReceipt);
      const po = await PurchaseOrder.findById(gr.purchaseOrder).lean();
      const doc = new PurchaseReturn({
        ...parsed,
        no: await nextDocNo('PRT'),
        goodsReceipt: gr._id,
        purchaseOrder: gr.purchaseOrder,
        vendor: gr.vendor,
        gudang: gr.gudang,
        status: 'DRAFT',
        createdBy: req.user._id,
      });
      doc.lines = await buildLines(gr, po, parsed.lines);
      doc.total = round2(doc.lines.reduce((s, l) => s + l.amount, 0));
      await doc.save();
      await audit.logCreate(req, 'purchaseReturn', [doc]);
      return doc;
    });
    return successResponse(res, stripCost(req, doc.toObject()), `${doc.no} saved as draft`, 201);
  } catch (error) {
    return handleError(res, error);
  }
};

/** PUT /api/purchase-return/:id — ubah draft (GR tidak bisa diganti) */
exports.updateReturn = async (req, res) => {
  try {
    const parsed = parseReturn(req.body);
    const doc = await runInTransaction(async () => {
      const doc = await loadDraft(req, req.params.id);
      const gr = await loadGr(req, doc.goodsReceipt);
      const po = await PurchaseOrder.findById(gr.purchaseOrder).lean();
      const before = await audit.snap('purchaseReturn', [doc]);
      Object.assign(doc, { date: parsed.date, reason: parsed.reason, resolution: parsed.resolution, note: parsed.note });
      doc.lines = await buildLines(gr, po, parsed.lines);
      doc.total = round2(doc.lines.reduce((s, l) => s + l.amount, 0));
      doc.updatedDate = new Date();
      doc.updatedBy = req.user._id;
      await doc.save();
      await audit.logUpdate(req, 'purchaseReturn', before, [doc]);
      return doc;
    });
    return successResponse(res, stripCost(req, doc.toObject()), `${doc.no} successfully updated`);
  } catch (error) {
    return handleError(res, error);
  }
};

/** DELETE /api/purchase-return/:id — hanya draft */
exports.deleteReturn = async (req, res) => {
  try {
    const doc = await runInTransaction(async () => {
      const doc = await loadDraft(req, req.params.id);
      await lock(ref('goodsReceipt', doc.goodsReceipt));
      const before = await audit.snap('purchaseReturn', [doc]);
      await doc.deleteOne();
      await audit.logDelete(req, 'purchaseReturn', before);
      return doc;
    });
    return successResponse(res, stripCost(req, doc.toObject()), `${doc.no} successfully deleted`);
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- post / cancel

/** Tagihan aktif yang dikurangi / dikembalikan nilainya oleh retur (di dalam transaksi) */
const adjustBill = async (req, billId, delta, batchId) => {
  if (!billId) return null;
  await lock(ref('purchaseInvoice', billId));
  const bill = await PurchaseInvoice.findById(billId);
  if (!bill || bill.status !== 'POSTED') return null;
  const before = await audit.snap('purchaseInvoice', [bill]);
  bill.returnedAmount = round2((bill.returnedAmount || 0) + delta);
  bill.paymentStatus = invoiceBalance(bill).paymentStatus;
  await bill.save();
  await audit.logUpdate(req, 'purchaseInvoice', before, [bill], { batchId });
  return bill;
};

/**
 * POST /api/purchase-return/:id/post — stok keluar (HPP = unitCost GR), GR.qtyReturned bertambah,
 * tagihan GR (jika ada) berkurang; REPLACE: qtyReceived PO berkurang (PO terbuka lagi).
 */
exports.postReturn = async (req, res) => {
  try {
    const doc = await runInTransaction(async () => {
      const doc = await loadDraft(req, req.params.id);
      const gr = await loadGr(req, doc.goodsReceipt);
      await lock(ref('purchaseOrder', gr.purchaseOrder), ref('gudang', gr.gudang));
      const po = await PurchaseOrder.findById(gr.purchaseOrder);
      if (!po) throw new HttpError('Purchase order no longer exists', 400);
      if (doc.resolution === 'REPLACE' && ['CLOSED', 'CANCELLED'].includes(po.status)) {
        throw new HttpError(`${po.no} is ${po.status.toLowerCase()}: replacement is not possible, choose "credit" instead`, 400);
      }
      const lines = await buildLines(gr, po.toObject(), doc.lines.map((l) => ({ poLine: String(l.poLine), qty: l.qty, note: l.note })));

      const batchId = audit.newBatchId();
      const before = await audit.snap('purchaseReturn', [doc]);
      const grBefore = await audit.snap('goodsReceipt', [gr]);
      await applyMovements(req, lines.map((l) => ({
        sku: l.sku,
        gudang: gr.gudang,
        qty: -l.qtyBase,
        unitCost: l.unitCost,
        type: 'PURCHASE_RETURN',
        note: [gr.no, doc.reason, l.note].filter(Boolean).join(' · '),
      })), { refType: 'PurchaseReturn', refId: doc._id, refNo: doc.no });

      lines.forEach((l) => {
        const gl = gr.lines.find((x) => String(x.poLine) === String(l.poLine));
        gl.qtyReturned = round2((gl.qtyReturned || 0) + l.qty);
      });
      await gr.save();
      await audit.logUpdate(req, 'goodsReceipt', grBefore, [gr], { batchId });

      if (doc.resolution === 'REPLACE') {
        const poBefore = await audit.snap('purchaseOrder', [po]);
        lines.forEach((l) => {
          const pl = po.lines.id(l.poLine);
          if (pl) pl.qtyReceived = Math.max(round2((pl.qtyReceived || 0) - l.qty), 0);
        });
        po.status = receiptStatus(po.lines);
        await po.save();
        await audit.logUpdate(req, 'purchaseOrder', poBefore, [po], { batchId });
      }

      doc.lines = lines;
      doc.total = round2(lines.reduce((s, l) => s + l.amount, 0));
      const bill = await adjustBill(req, gr.purchaseInvoice, doc.total, batchId);
      doc.purchaseInvoice = bill ? bill._id : null;
      Object.assign(doc, { status: 'POSTED', postedBy: req.user._id, postedDate: new Date() });
      await doc.save();
      await audit.logUpdate(req, 'purchaseReturn', before, [doc], { batchId });
      return doc;
    });
    return successResponse(res, stripCost(req, doc.toObject()), `${doc.no} successfully posted`);
  } catch (error) {
    return handleError(res, error);
  }
};

/** POST /api/purchase-return/:id/cancel { reason } — pembalik (stok masuk lagi), tagihan & PO dikembalikan */
exports.cancelReturn = async (req, res) => {
  try {
    const reason = trimText(req.body?.reason);
    if (!reason) return errorResponse(res, 'Cancellation reason is required', 400);
    if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 'Purchase return not found', 404);
    const doc = await runInTransaction(async () => {
      const doc = await PurchaseReturn.findById(req.params.id);
      if (!doc) throw new HttpError('Purchase return not found', 404);
      assertGudang(req, doc.gudang);
      if (doc.status !== 'POSTED') throw new HttpError(doc.status === 'DRAFT' ? 'Draft returns are deleted, not cancelled' : 'Purchase return is already cancelled', 400);
      await lock(ref('goodsReceipt', doc.goodsReceipt), ref('purchaseOrder', doc.purchaseOrder));
      const gr = await GoodsReceipt.findById(doc.goodsReceipt);
      if (!gr) throw new HttpError('Goods receipt no longer exists', 400);
      // GR ditagih oleh tagihan lain (mis. ditagih ulang setelah retur): qty tagihan sudah tanpa barang ini
      if (gr.purchaseInvoice && String(gr.purchaseInvoice) !== String(doc.purchaseInvoice)) {
        const bill = await PurchaseInvoice.findById(gr.purchaseInvoice).select('no').lean();
        throw new HttpError(`${gr.no} was billed after this return (${bill?.no || 'vendor bill'}). Cancel that bill first.`, 400);
      }
      const po = await PurchaseOrder.findById(doc.purchaseOrder);
      const batchId = audit.newBatchId();
      const before = await audit.snap('purchaseReturn', [doc]);

      if (doc.resolution === 'REPLACE' && po) {
        const poBefore = await audit.snap('purchaseOrder', [po]);
        for (const l of doc.lines) {
          const pl = po.lines.id(l.poLine);
          if (!pl) continue;
          const next = round2((pl.qtyReceived || 0) + l.qty);
          if (next > pl.qty) throw new HttpError(`Replacement goods were already received on ${po.no}. Return them first, or keep this return.`, 400);
          pl.qtyReceived = next;
        }
        if (po.status !== 'CLOSED') po.status = receiptStatus(po.lines);
        await po.save();
        await audit.logUpdate(req, 'purchaseOrder', poBefore, [po], { batchId });
      }

      await applyMovements(req, doc.lines.map((l) => ({
        sku: l.sku,
        gudang: doc.gudang,
        qty: l.qtyBase,
        unitCost: l.unitCost,
        type: 'PURCHASE_RETURN',
        note: `Cancelled: ${reason}`,
      })), { refType: 'PurchaseReturn', refId: doc._id, refNo: doc.no, isReversal: true });

      const grBefore = await audit.snap('goodsReceipt', [gr]);
      doc.lines.forEach((l) => {
        const gl = gr.lines.find((x) => String(x.poLine) === String(l.poLine));
        if (gl) gl.qtyReturned = Math.max(round2((gl.qtyReturned || 0) - l.qty), 0);
      });
      await gr.save();
      await audit.logUpdate(req, 'goodsReceipt', grBefore, [gr], { batchId });
      await adjustBill(req, doc.purchaseInvoice, -doc.total, batchId);

      Object.assign(doc, { status: 'CANCELLED', cancelReason: reason, cancelledBy: req.user._id, cancelledDate: new Date() });
      await doc.save();
      await audit.logUpdate(req, 'purchaseReturn', before, [doc], { batchId });
      return doc;
    });
    return successResponse(res, stripCost(req, doc.toObject()), `${doc.no} cancelled`);
  } catch (error) {
    return handleError(res, error);
  }
};
