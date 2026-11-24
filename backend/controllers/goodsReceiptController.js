const mongoose = require('mongoose');
const GoodsReceipt = require('../models/GoodsReceipt');
const PurchaseOrder = require('../models/PurchaseOrder');
const VendorPrice = require('../models/VendorPrice');
const { successResponse, errorResponse } = require('../helpers/responseHelper');
const audit = require('../helpers/auditLogger');
const { runInTransaction, HttpError, lock, ref } = require('../helpers/transaction');
const { applyMovements, nextDocNo } = require('../helpers/stockHelper');
const { checkAmount, round2 } = require('../helpers/number');
const { unitCostOf, outstandingOf, receiptStatus } = require('../helpers/purchaseHelper');
const { hasPermission } = require('../config/permissions');
const { assertGudang, applyGudangFilter } = require('../helpers/gudangAccess');

const STATUSES = ['DRAFT', 'POSTED', 'CANCELLED'];
const SORTABLE_FIELDS = ['no', 'date', 'createdDate', 'updatedDate', 'postedDate'];

const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status);
  if (error.name === 'ValidationError' || error.name === 'CastError') return errorResponse(res, error.message, 400);
  return errorResponse(res, error.message, 500);
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const trimText = (v, max = 500) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));
const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

/** Validasi isi GR dari body (murni). */
const parseGr = (body) => {
  const date = body.date ? new Date(body.date) : new Date();
  if (Number.isNaN(date.getTime())) throw new HttpError('Invalid receipt date', 400);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  if (date > endOfToday) throw new HttpError('Receipt date cannot be in the future', 400);

  const input = (Array.isArray(body.lines) ? body.lines : []).filter((l) => Number(l?.qty) !== 0 || l?.note);
  if (!input.length) throw new HttpError('Fill in the received quantity for at least one item', 400);

  const seen = new Set();
  const lines = input.map((l, i) => {
    const n = `Line ${i + 1}`;
    if (!mongoose.isValidObjectId(l?.poLine)) throw new HttpError(`${n}: invalid PO line`, 400);
    if (seen.has(String(l.poLine))) throw new HttpError(`${n}: the same PO line appears more than once`, 400);
    seen.add(String(l.poLine));
    const err = checkAmount(l.qty, 'Received quantity', { min: 0, exclusive: true });
    if (err) throw new HttpError(`${n}: ${err}`, 400);
    return { poLine: String(l.poLine), qty: round2(l.qty), note: trimText(l.note, 200) || undefined };
  });

  return { date, deliveryNoteNo: trimText(body.deliveryNoteNo, 100), note: trimText(body.note), lines };
};

/**
 * PO yang bisa diterima (OPEN / PARTIAL), dikunci: bentrok dengan cancel/close PO & GR lain.
 * Throw jika tidak ada / statusnya tidak bisa menerima barang.
 */
const loadReceivablePo = async (poId) => {
  if (!mongoose.isValidObjectId(poId)) throw new HttpError('Please select a purchase order', 400);
  await lock(ref('purchaseOrder', poId));
  const po = await PurchaseOrder.findById(poId);
  if (!po) throw new HttpError('Purchase order not found', 404);
  if (!['OPEN', 'PARTIAL'].includes(po.status)) {
    throw new HttpError(`${po.no} is ${po.status.toLowerCase()} and cannot receive goods`, 400);
  }
  return po;
};

/** Baris GR lengkap dari baris PO (snapshot sku/uom/konversi/harga pokok). Qty <= sisa PO. */
const buildLines = (po, parsedLines, skus) => parsedLines.map((l) => {
  const poLine = po.lines.id(l.poLine);
  if (!poLine) throw new HttpError('One or more lines do not belong to this purchase order', 400);
  const outstanding = outstandingOf(poLine);
  if (l.qty > outstanding) {
    const code = skus?.get(String(poLine.sku)) || 'Item';
    throw new HttpError(`${code}: received ${fmt(l.qty)} exceeds the outstanding quantity ${fmt(outstanding)}`, 400);
  }
  return {
    poLine: poLine._id,
    sku: poLine.sku,
    produk: poLine.produk,
    uomBeli: poLine.uomBeli,
    konversi: poLine.konversi,
    qty: l.qty,
    qtyBase: round2(l.qty * poLine.konversi),
    unitCost: unitCostOf(po, poLine),
    note: l.note,
  };
});

const skuCodes = async (po) => {
  const rows = await mongoose.model('ProdukSku').find({ _id: { $in: po.lines.map((l) => l.sku) } }).select('sku').lean();
  return new Map(rows.map((r) => [String(r._id), r.sku]));
};

const populateGr = (query) => query
  .populate('purchaseOrder', 'no status date isPKP taxRate')
  .populate('vendor', 'companyName')
  .populate('gudang', 'code name')
  .populate('lines.sku', 'sku variantValues isActive')
  .populate({ path: 'lines.produk', select: 'name uom', populate: { path: 'uom', select: 'code' } })
  .populate('lines.uomBeli', 'code name')
  .populate('createdBy', 'name')
  .populate('updatedBy', 'name')
  .populate('postedBy', 'name')
  .populate('cancelledBy', 'name');

// ---------------------------------------------------------------- baca

// GET /api/goods-receipt — daftar GR (tanpa baris)
exports.getGoodsReceipts = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || 1) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || 10) || 10, 1), 100);
    const sortField = SORTABLE_FIELDS.includes(req.query.sortField) ? req.query.sortField : 'createdDate';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const filter = {};

    if (req.query.search) {
      const rx = { $regex: escapeRegex(req.query.search), $options: 'i' };
      const poIds = await PurchaseOrder.find({ no: rx }).distinct('_id');
      filter.$or = [{ no: rx }, { deliveryNoteNo: rx }, { note: rx }, { purchaseOrder: { $in: poIds } }];
    }
    if (STATUSES.includes(req.query.status)) filter.status = req.query.status;
    applyGudangFilter(req, filter, req.query.gudang); // hanya gudang yang boleh diakses
    for (const key of ['vendor', 'purchaseOrder']) {
      if (!req.query[key]) continue;
      if (!mongoose.isValidObjectId(req.query[key])) return errorResponse(res, `Invalid ${key}`, 400);
      filter[key] = req.query[key];
    }
    if (req.query.from || req.query.to) {
      filter.date = {};
      if (req.query.from) filter.date.$gte = new Date(`${req.query.from}T00:00:00`);
      if (req.query.to) filter.date.$lte = new Date(`${req.query.to}T23:59:59.999`);
      if (Object.values(filter.date).some((d) => Number.isNaN(d.getTime()))) return errorResponse(res, 'Invalid date', 400);
    }

    const [totalData, docs] = await Promise.all([
      GoodsReceipt.countDocuments(filter),
      GoodsReceipt.find(filter)
        .select('-lines')
        .populate('purchaseOrder', 'no')
        .populate('vendor', 'companyName')
        .populate('gudang', 'code name')
        .populate('createdBy', 'name')
        .populate('updatedBy', 'name')
        .sort({ [sortField]: sortOrder, _id: sortOrder })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);
    const counts = await GoodsReceipt.aggregate([
      { $match: { _id: { $in: docs.map((d) => d._id) } } },
      { $project: { lineCount: { $size: '$lines' } } },
    ]);
    const countMap = new Map(counts.map((c) => [String(c._id), c.lineCount]));
    docs.forEach((d) => { d.lineCount = countMap.get(String(d._id)) || 0; });

    return successResponse(res, {
      dataGoodsReceipt: docs,
      totalData,
      currentPage: page,
      totalPages: Math.ceil(totalData / pageSize),
    });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * GET /api/goods-receipt/po-options?search= — PO yang bisa diterima (OPEN / PARTIAL), maks. 20.
 * Dipakai form GR (cukup izin goodsReceipt:view, tidak butuh izin purchaseOrder).
 */
exports.getPoOptions = async (req, res) => {
  try {
    const filter = applyGudangFilter(req, { status: { $in: ['OPEN', 'PARTIAL'] } });
    if (req.query.search) filter.no = { $regex: escapeRegex(req.query.search), $options: 'i' };
    const pos = await PurchaseOrder.find(filter)
      .select('no date status vendor gudang expectedDate')
      .populate('vendor', 'companyName')
      .populate('gudang', 'code name')
      .sort({ date: -1 })
      .limit(20)
      .lean();
    return successResponse(res, pos);
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * GET /api/goods-receipt/from-po/:poId — data PO untuk mengisi GR: baris + sisa yang belum diterima.
 */
exports.getPoForReceipt = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.poId)) return errorResponse(res, 'Invalid purchase order', 400);
    const po = await PurchaseOrder.findById(req.params.poId)
      .select('no date status vendor gudang isPKP taxRate lines expectedDate')
      .populate('vendor', 'companyName')
      .populate('gudang', 'code name')
      .populate('lines.sku', 'sku variantValues')
      .populate({ path: 'lines.produk', select: 'name uom', populate: { path: 'uom', select: 'code' } })
      .populate('lines.uomBeli', 'code name')
      .lean();
    if (!po) return errorResponse(res, 'Purchase order not found', 404);
    assertGudang(req, po.gudang?._id);
    po.lines.forEach((l) => {
      l.outstanding = outstandingOf(l);
      l.unitCost = unitCostOf(po, l);
      delete l.hargaBeli; // harga beli cukup tampil di PO; GR menampilkan HPP per satuan dasar
      delete l.subtotal;
    });
    return successResponse(res, po);
  } catch (error) {
    return handleError(res, error);
  }
};

// GET /api/goods-receipt/:id — GR lengkap (+ sisa PO per baris untuk draft)
exports.getGoodsReceipt = async (req, res) => {
  try {
    const gr = await populateGr(GoodsReceipt.findById(req.params.id)).lean();
    if (!gr) return errorResponse(res, 'Goods receipt not found', 404);
    assertGudang(req, gr.gudang?._id);
    const po = await PurchaseOrder.findById(gr.purchaseOrder?._id).select('lines').lean();
    const poLines = new Map((po?.lines || []).map((l) => [String(l._id), l]));
    gr.lines.forEach((l) => {
      const pl = poLines.get(String(l.poLine));
      l.ordered = pl?.qty ?? null;
      l.received = pl?.qtyReceived ?? null;
      l.outstanding = pl ? outstandingOf(pl) : null;
    });
    return successResponse(res, gr);
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- draft

// POST /api/goods-receipt  body: { purchaseOrder, date, deliveryNoteNo, note, lines: [{ poLine, qty, note }] }
exports.createGoodsReceipt = async (req, res) => {
  try {
    const parsed = parseGr(req.body);
    const gr = await runInTransaction(async () => {
      const po = await loadReceivablePo(req.body.purchaseOrder);
      assertGudang(req, po.gudang);
      const lines = buildLines(po, parsed.lines, await skuCodes(po));
      const doc = await GoodsReceipt.create({
        ...parsed,
        lines,
        no: await nextDocNo('GR'),
        purchaseOrder: po._id,
        vendor: po.vendor,
        gudang: po.gudang,
        status: 'DRAFT',
        createdBy: req.user._id,
      });
      await audit.logCreate(req, 'goodsReceipt', [doc]);
      return doc;
    });
    return successResponse(res, gr, `${gr.no} saved as draft`, 201);
  } catch (error) {
    return handleError(res, error);
  }
};

const loadDraft = async (req, id) => {
  const doc = await GoodsReceipt.findById(id);
  if (!doc) throw new HttpError('Goods receipt not found', 404);
  assertGudang(req, doc.gudang);
  if (doc.status !== 'DRAFT') throw new HttpError(`Goods receipt is already ${doc.status.toLowerCase()} and can no longer be changed`, 400);
  return doc;
};

// PUT /api/goods-receipt/:id — ubah draft (PO tidak bisa diganti)
exports.updateGoodsReceipt = async (req, res) => {
  try {
    const gr = await runInTransaction(async () => {
      const doc = await loadDraft(req, req.params.id);
      const parsed = parseGr(req.body);
      const po = await loadReceivablePo(doc.purchaseOrder);
      const before = await audit.snap('goodsReceipt', [doc]);
      doc.date = parsed.date;
      doc.deliveryNoteNo = parsed.deliveryNoteNo;
      doc.note = parsed.note;
      doc.lines = buildLines(po, parsed.lines, await skuCodes(po));
      doc.updatedDate = new Date();
      doc.updatedBy = req.user._id;
      await doc.save();
      await audit.logUpdate(req, 'goodsReceipt', before, [doc]);
      return doc;
    });
    return successResponse(res, gr, `${gr.no} successfully updated`);
  } catch (error) {
    return handleError(res, error);
  }
};

// DELETE /api/goods-receipt/:id — hanya draft
exports.deleteGoodsReceipt = async (req, res) => {
  try {
    const gr = await runInTransaction(async () => {
      const doc = await GoodsReceipt.findById(req.params.id);
      if (!doc) throw new HttpError('Goods receipt not found', 404);
      assertGudang(req, doc.gudang);
      if (doc.status !== 'DRAFT') throw new HttpError('Only draft goods receipts can be deleted. Cancel a posted one instead.', 400);
      await lock(ref('purchaseOrder', doc.purchaseOrder));
      const before = await audit.snap('goodsReceipt', [doc]);
      await doc.deleteOne();
      await audit.logDelete(req, 'goodsReceipt', before);
      return doc;
    });
    return successResponse(res, gr, `${gr.no} successfully deleted`);
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- post & cancel (izin 'post')

/**
 * Perbarui daftar harga vendor dari harga PO (opsi saat post GR). Butuh izin vendorPrice create & update.
 * Hanya baris yang harga/konversinya berbeda (atau belum ada) yang ditulis & diaudit.
 */
const updateVendorPrices = async (req, po, grLines, batchId) => {
  const poLines = grLines.map((l) => po.lines.id(l.poLine));
  const existing = await VendorPrice.find({
    vendor: po.vendor,
    $or: poLines.map((l) => ({ sku: l.sku, uomBeli: l.uomBeli })),
  });
  const key = (sku, uom) => `${sku}:${uom}`;
  const byKey = new Map(existing.map((p) => [key(p.sku, p.uomBeli), p]));

  const changed = existing.filter((p) => {
    const l = poLines.find((x) => key(x.sku, x.uomBeli) === key(p.sku, p.uomBeli));
    return l && (p.hargaBeli !== l.hargaBeli || p.konversi !== l.konversi);
  });
  const before = await audit.snap('vendorPrice', changed);
  const now = new Date();
  for (const p of changed) {
    const l = poLines.find((x) => key(x.sku, x.uomBeli) === key(p.sku, p.uomBeli));
    p.hargaBeli = l.hargaBeli;
    p.konversi = l.konversi;
    p.updatedDate = now;
    p.updatedBy = req.user._id;
    await p.save();
  }
  await audit.logUpdate(req, 'vendorPrice', before, changed, { batchId });

  const toCreate = poLines.filter((l, i, arr) => !byKey.has(key(l.sku, l.uomBeli))
    && arr.findIndex((x) => key(x.sku, x.uomBeli) === key(l.sku, l.uomBeli)) === i);
  if (toCreate.length) {
    const created = await VendorPrice.insertMany(toCreate.map((l) => ({
      vendor: po.vendor,
      produk: l.produk,
      sku: l.sku,
      uomBeli: l.uomBeli,
      konversi: l.konversi,
      hargaBeli: l.hargaBeli,
      catatan: `From ${po.no}`,
      createdBy: req.user._id,
    })));
    await audit.logCreate(req, 'vendorPrice', created, { batchId });
  }
  return changed.length + toCreate.length;
};

/**
 * POST /api/goods-receipt/:id/post  body: { updateVendorPrice?: boolean }
 * 1 transaksi: stok gudang PO bertambah (movement PURCHASE + HPP), qtyReceived & status PO diperbarui,
 * opsional daftar harga vendor diperbarui dari harga PO. Qty melebihi sisa PO -> ditolak.
 */
exports.postGoodsReceipt = async (req, res) => {
  try {
    const wantPriceUpdate = req.body?.updateVendorPrice === true;
    if (wantPriceUpdate && !(hasPermission(req.user, 'vendorPrice', 'create') && hasPermission(req.user, 'vendorPrice', 'update'))) {
      return errorResponse(res, "You don't have permission to update vendor prices", 403);
    }

    let priceUpdates = 0;
    const gr = await runInTransaction(async () => {
      const doc = await loadDraft(req, req.params.id);
      const po = await loadReceivablePo(doc.purchaseOrder);
      if (wantPriceUpdate) await lock(ref('vendor', po.vendor));

      // hitung ulang dari PO (qty tetap; sisa diperiksa terhadap kondisi PO terbaru)
      const lines = buildLines(po, doc.lines.map((l) => ({ poLine: l.poLine, qty: l.qty, note: l.note })), await skuCodes(po));
      const batchId = audit.newBatchId();
      const grBefore = await audit.snap('goodsReceipt', [doc]);
      const poBefore = await audit.snap('purchaseOrder', [po]);

      await applyMovements(req, lines.map((l) => ({
        sku: l.sku,
        gudang: po.gudang,
        qty: l.qtyBase,
        unitCost: l.unitCost,
        type: 'PURCHASE',
        note: [po.no, l.note].filter(Boolean).join(' · '),
      })), { refType: 'GoodsReceipt', refId: doc._id, refNo: doc.no });

      for (const l of lines) {
        const pl = po.lines.id(l.poLine);
        pl.qtyReceived = round2((pl.qtyReceived || 0) + l.qty);
      }
      po.status = receiptStatus(po.lines);
      await po.save();

      doc.lines = lines;
      doc.status = 'POSTED';
      doc.postedBy = req.user._id;
      doc.postedDate = new Date();
      await doc.save();

      await audit.logUpdate(req, 'goodsReceipt', grBefore, [doc], { batchId });
      await audit.logUpdate(req, 'purchaseOrder', poBefore, [po], { batchId });
      if (wantPriceUpdate) priceUpdates = await updateVendorPrices(req, po, lines, batchId);
      return doc;
    });

    const extra = wantPriceUpdate ? ` (${priceUpdates} vendor price(s) updated)` : '';
    return successResponse(res, gr, `${gr.no} successfully posted${extra}`);
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * POST /api/goods-receipt/:id/cancel  body: { reason }
 * Membalik GR yang sudah diposting: movement pembalik (HPP dihitung balik), qtyReceived PO berkurang.
 * Ditolak jika stok sekarang tidak cukup. Harga vendor yang sempat diperbarui TIDAK dikembalikan.
 */
exports.cancelGoodsReceipt = async (req, res) => {
  try {
    const reason = trimText(req.body.reason);
    if (!reason) return errorResponse(res, 'Cancellation reason is required', 400);

    const gr = await runInTransaction(async () => {
      const doc = await GoodsReceipt.findById(req.params.id);
      if (!doc) throw new HttpError('Goods receipt not found', 404);
      assertGudang(req, doc.gudang);
      if (doc.status !== 'POSTED') throw new HttpError('Only posted goods receipts can be cancelled', 400);

      await lock(ref('purchaseOrder', doc.purchaseOrder));
      const po = await PurchaseOrder.findById(doc.purchaseOrder);
      if (!po) throw new HttpError('Purchase order no longer exists', 400);

      const batchId = audit.newBatchId();
      const grBefore = await audit.snap('goodsReceipt', [doc]);
      const poBefore = await audit.snap('purchaseOrder', [po]);

      await applyMovements(req, doc.lines.map((l) => ({
        sku: l.sku,
        gudang: doc.gudang,
        qty: -l.qtyBase,
        unitCost: l.unitCost,
        type: 'PURCHASE',
        note: `Cancelled: ${reason}`,
      })), { refType: 'GoodsReceipt', refId: doc._id, refNo: doc.no, isReversal: true });

      for (const l of doc.lines) {
        const pl = po.lines.id(l.poLine);
        if (pl) pl.qtyReceived = Math.max(round2((pl.qtyReceived || 0) - l.qty), 0);
      }
      // PO yang sudah ditutup tetap CLOSED; selain itu status mengikuti penerimaan
      if (po.status !== 'CLOSED') po.status = receiptStatus(po.lines);
      await po.save();

      doc.status = 'CANCELLED';
      doc.cancelReason = reason;
      doc.cancelledBy = req.user._id;
      doc.cancelledDate = new Date();
      await doc.save();

      await audit.logUpdate(req, 'goodsReceipt', grBefore, [doc], { batchId });
      await audit.logUpdate(req, 'purchaseOrder', poBefore, [po], { batchId });
      return doc;
    });
    return successResponse(res, gr, `${gr.no} cancelled`);
  } catch (error) {
    return handleError(res, error);
  }
};
