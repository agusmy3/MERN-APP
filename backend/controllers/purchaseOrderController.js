const mongoose = require('mongoose');
const PurchaseOrder = require('../models/PurchaseOrder');
const GoodsReceipt = require('../models/GoodsReceipt');
const ProdukSku = require('../models/ProdukSku');
const Produk = require('../models/Produk');
const VendorPrice = require('../models/VendorPrice');
const Vendor = require('../models/Vendor');
const Gudang = require('../models/Gudang');
const Uom = require('../models/Uom');
const { successResponse, errorResponse } = require('../helpers/responseHelper');
const audit = require('../helpers/auditLogger');
const { runInTransaction, HttpError, lock, ref } = require('../helpers/transaction');
const { nextDocNo } = require('../helpers/stockHelper');
const { getSettings } = require('../helpers/settings');
const { checkAmount, round2 } = require('../helpers/number');
const { lineSubtotal, poTotals, outstandingOf, unitCostOf } = require('../helpers/purchaseHelper');
const { MAX_LINES } = require('../config/stock');

const STATUSES = ['DRAFT', 'OPEN', 'PARTIAL', 'RECEIVED', 'CLOSED', 'CANCELLED'];
const SORTABLE_FIELDS = ['no', 'date', 'expectedDate', 'total', 'createdDate', 'updatedDate'];

const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status);
  if (error.name === 'ValidationError' || error.name === 'CastError') return errorResponse(res, error.message, 400);
  return errorResponse(res, error.message, 500);
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const trimText = (v, max = 500) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));
const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; };

/** Validasi isi PO dari body (murni). taxRate undefined -> diisi default setting nanti. */
const parsePo = (body) => {
  if (!mongoose.isValidObjectId(body.vendor)) throw new HttpError('Please select a vendor', 400);
  if (!mongoose.isValidObjectId(body.gudang)) throw new HttpError('Please select a destination warehouse', 400);

  const date = body.date ? new Date(body.date) : new Date();
  if (Number.isNaN(date.getTime())) throw new HttpError('Invalid PO date', 400);
  if (date > endOfToday()) throw new HttpError('PO date cannot be in the future', 400);
  let expectedDate = null;
  if (body.expectedDate) {
    expectedDate = new Date(body.expectedDate);
    if (Number.isNaN(expectedDate.getTime())) throw new HttpError('Invalid expected date', 400);
    const startOfPoDay = new Date(date);
    startOfPoDay.setHours(0, 0, 0, 0);
    if (expectedDate < startOfPoDay) throw new HttpError('Expected date cannot be before the PO date', 400);
  }

  let taxRate;
  if (body.taxRate !== undefined && body.taxRate !== null && body.taxRate !== '') {
    const err = checkAmount(body.taxRate, 'Tax rate');
    if (err) throw new HttpError(err, 400);
    taxRate = round2(body.taxRate);
    if (taxRate > 100) throw new HttpError('Tax rate must be <= 100', 400);
  }

  const input = Array.isArray(body.lines) ? body.lines : [];
  if (!input.length) throw new HttpError('Add at least one item', 400);
  if (input.length > MAX_LINES) throw new HttpError(`A PO can have at most ${MAX_LINES} lines`, 400);

  const seen = new Set();
  const lines = input.map((l, i) => {
    const n = `Line ${i + 1}`;
    if (!mongoose.isValidObjectId(l?.sku)) throw new HttpError(`${n}: invalid SKU`, 400);
    if (!mongoose.isValidObjectId(l?.uomBeli)) throw new HttpError(`${n}: please select a purchase UoM`, 400);
    const key = `${l.sku}:${l.uomBeli}`;
    if (seen.has(key)) throw new HttpError(`${n}: the same SKU & UoM appears more than once`, 400);
    seen.add(key);

    const err = checkAmount(l.qty, 'Quantity', { min: 0, exclusive: true })
      || checkAmount(l.konversi, 'Conversion', { min: 0, exclusive: true })
      || checkAmount(l.hargaBeli, 'Price')
      || checkAmount(l.diskonPersen ?? 0, 'Discount');
    if (err) throw new HttpError(`${n}: ${err}`, 400);
    const diskonPersen = round2(l.diskonPersen ?? 0);
    if (diskonPersen > 100) throw new HttpError(`${n}: Discount must be <= 100`, 400);

    const line = {
      sku: String(l.sku),
      uomBeli: String(l.uomBeli),
      konversi: round2(l.konversi),
      qty: round2(l.qty),
      hargaBeli: round2(l.hargaBeli),
      diskonPersen,
      qtyReceived: 0,
      note: trimText(l.note, 200) || undefined,
    };
    line.subtotal = lineSubtotal(line);
    return line;
  });

  return { vendor: String(body.vendor), gudang: String(body.gudang), date, expectedDate, taxRate, note: trimText(body.note), lines };
};

/** Referensi di dalam transaksi + kunci (bentrok dengan hapus vendor/gudang/UoM/produk). Mengisi line.produk. */
const resolveRefs = async (parsed) => {
  const skuIds = parsed.lines.map((l) => l.sku);
  const uomIds = [...new Set(parsed.lines.map((l) => l.uomBeli))];
  const owners = await ProdukSku.find({ _id: { $in: skuIds } }).select('produk').lean();
  await lock(
    ref('vendor', parsed.vendor), ref('gudang', parsed.gudang),
    uomIds.map((id) => ref('uom', id)),
    [...new Set(owners.map((s) => String(s.produk)))].map((id) => ref('produk', id))
  );

  if (!(await Vendor.exists({ _id: parsed.vendor }))) throw new HttpError('Please select a valid vendor', 400);
  const gudang = await Gudang.findById(parsed.gudang).select('isActive').lean();
  if (!gudang) throw new HttpError('Please select a valid warehouse', 400);
  if (gudang.isActive === false) throw new HttpError('Warehouse is inactive', 400);
  if ((await Uom.countDocuments({ _id: { $in: uomIds } })) !== uomIds.length) throw new HttpError('One or more UoMs are not valid', 400);

  const skus = await ProdukSku.find({ _id: { $in: skuIds } }).select('sku produk isActive').lean();
  if (skus.length !== new Set(skuIds).size) throw new HttpError('One or more SKUs no longer exist', 400);
  const inactive = skus.find((s) => s.isActive === false);
  if (inactive) throw new HttpError(`${inactive.sku} is inactive and cannot be ordered`, 400);
  const produkOf = new Map(skus.map((s) => [String(s._id), s.produk]));
  parsed.lines.forEach((l) => { l.produk = produkOf.get(l.sku); });
};

/** Terapkan isi PO + snapshot setting pajak + total */
const fillPo = (doc, parsed, settings) => {
  doc.vendor = parsed.vendor;
  doc.gudang = parsed.gudang;
  doc.date = parsed.date;
  doc.expectedDate = parsed.expectedDate;
  doc.note = parsed.note;
  doc.lines = parsed.lines;
  doc.isPKP = settings['tax.isPKP'] !== false;
  doc.taxRate = parsed.taxRate ?? settings['tax.ppnRate'] ?? 0;
  Object.assign(doc, poTotals(parsed.lines, doc.taxRate));
};

const issue = (doc, req) => {
  doc.status = 'OPEN';
  doc.issuedBy = req.user._id;
  doc.issuedDate = new Date();
};

const populatePo = (query) => query
  .populate('vendor', 'companyName picName picContact')
  .populate('gudang', 'code name isActive')
  .populate('lines.sku', 'sku variantValues isActive')
  .populate({ path: 'lines.produk', select: 'name uom', populate: { path: 'uom', select: 'code' } })
  .populate('lines.uomBeli', 'code name')
  .populate('createdBy', 'name')
  .populate('updatedBy', 'name')
  .populate('issuedBy', 'name')
  .populate('closedBy', 'name')
  .populate('cancelledBy', 'name');

// ---------------------------------------------------------------- baca

// GET /api/purchase-order — daftar PO (tanpa baris). status=ACTIVE -> OPEN + PARTIAL
exports.getPurchaseOrders = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || 1) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || 10) || 10, 1), 100);
    const sortField = SORTABLE_FIELDS.includes(req.query.sortField) ? req.query.sortField : 'createdDate';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const filter = {};

    if (req.query.search) {
      const rx = { $regex: escapeRegex(req.query.search), $options: 'i' };
      filter.$or = [{ no: rx }, { note: rx }];
    }
    if (req.query.status === 'ACTIVE') filter.status = { $in: ['OPEN', 'PARTIAL'] };
    else if (STATUSES.includes(req.query.status)) filter.status = req.query.status;
    for (const key of ['vendor', 'gudang']) {
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
      PurchaseOrder.countDocuments(filter),
      PurchaseOrder.find(filter)
        .select('-lines')
        .populate('vendor', 'companyName')
        .populate('gudang', 'code name')
        .populate('createdBy', 'name')
        .populate('updatedBy', 'name')
        .sort({ [sortField]: sortOrder, _id: sortOrder })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);

    // jumlah baris & progres penerimaan (% qty dalam SATUAN DASAR, karena satuan beli per baris bisa beda)
    const baseSum = (field) => ({
      $sum: { $map: { input: '$lines', as: 'l', in: { $multiply: [{ $ifNull: [`$$l.${field}`, 0] }, '$$l.konversi'] } } },
    });
    const stats = await PurchaseOrder.aggregate([
      { $match: { _id: { $in: docs.map((d) => d._id) } } },
      { $project: { lineCount: { $size: '$lines' }, qty: baseSum('qty'), received: baseSum('qtyReceived') } },
    ]);
    const statMap = new Map(stats.map((s) => [String(s._id), s]));
    docs.forEach((d) => {
      const s = statMap.get(String(d._id));
      d.lineCount = s?.lineCount || 0;
      d.receivedPercent = s?.qty ? Math.min(Math.round((s.received / s.qty) * 100), 100) : 0;
    });

    return successResponse(res, {
      dataPurchaseOrder: docs,
      totalData,
      currentPage: page,
      totalPages: Math.ceil(totalData / pageSize),
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// GET /api/purchase-order/:id — PO lengkap + daftar penerimaannya
exports.getPurchaseOrder = async (req, res) => {
  try {
    const po = await populatePo(PurchaseOrder.findById(req.params.id)).lean();
    if (!po) return errorResponse(res, 'Purchase order not found', 404);
    po.lines.forEach((l) => {
      l.outstanding = outstandingOf(l);
      l.unitCost = unitCostOf(po, l);
    });
    po.receipts = await GoodsReceipt.find({ purchaseOrder: po._id })
      .select('no date status deliveryNoteNo postedDate')
      .sort({ createdDate: 1 })
      .lean();
    return successResponse(res, po);
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * GET /api/purchase-order/items?vendor=&search=
 * Cari SKU untuk baris PO + pilihan harga dari vendor tsb (satuan beli, konversi, harga, min. order).
 * Tanpa search: semua SKU yang punya harga dari vendor ini.
 */
exports.searchItems = async (req, res) => {
  try {
    const { vendor, search } = req.query;
    if (!mongoose.isValidObjectId(vendor)) return errorResponse(res, 'Please select a vendor first', 400);

    const filter = { isActive: true };
    const q = String(search || '').trim();
    if (q) {
      const rx = { $regex: escapeRegex(q), $options: 'i' };
      const produkIds = await Produk.find({ name: rx }).distinct('_id');
      filter.$or = [{ sku: rx }, { produk: { $in: produkIds } }];
    } else {
      filter._id = { $in: await VendorPrice.find({ vendor }).distinct('sku') };
    }

    const skus = await ProdukSku.find(filter)
      .select('sku produk variantValues')
      .populate({ path: 'produk', select: 'name uom', populate: { path: 'uom', select: 'code name' } })
      .sort({ sku: 1 })
      .limit(q ? 20 : 200)
      .lean();

    const prices = await VendorPrice.find({ vendor, sku: { $in: skus.map((s) => s._id) } })
      .populate('uomBeli', 'code name')
      .lean();
    const bySku = new Map();
    prices.forEach((p) => {
      const list = bySku.get(String(p.sku)) || [];
      list.push({
        uomBeli: p.uomBeli,
        konversi: p.konversi,
        hargaBeli: p.hargaBeli,
        minOrder: p.minOrder,
        isPreferred: p.isPreferred,
      });
      bySku.set(String(p.sku), list);
    });

    return successResponse(res, skus.map((s) => ({
      _id: s._id,
      sku: s.sku,
      variant: (s.variantValues || []).map((v) => v.value).join(' / ') || 'Default',
      produk: s.produk ? { _id: s.produk._id, name: s.produk.name } : null,
      baseUom: s.produk?.uom || null,
      prices: bySku.get(String(s._id)) || [],
    })));
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- draft / terbit

/** POST /api/purchase-order  body: { ...PO, issue?: true } -> draft, atau langsung terbit (OPEN) */
exports.createPurchaseOrder = async (req, res) => {
  try {
    const parsed = parsePo(req.body);
    const po = await runInTransaction(async () => {
      await resolveRefs(parsed);
      const settings = await getSettings();
      const doc = new PurchaseOrder({ no: await nextDocNo('PO'), createdBy: req.user._id });
      fillPo(doc, parsed, settings);
      if (req.body.issue === true) issue(doc, req);
      await doc.save();
      await audit.logCreate(req, 'purchaseOrder', [doc]);
      return doc;
    });
    return successResponse(res, po, `${po.no} ${po.status === 'OPEN' ? 'issued' : 'saved as draft'}`, 201);
  } catch (error) {
    return handleError(res, error);
  }
};

const loadDraft = async (id) => {
  const doc = await PurchaseOrder.findById(id);
  if (!doc) throw new HttpError('Purchase order not found', 404);
  if (doc.status !== 'DRAFT') {
    throw new HttpError('Only draft POs can be changed. Cancel this PO and create a new one instead.', 400);
  }
  return doc;
};

/** PUT /api/purchase-order/:id  body: { ...PO, issue?: true } — hanya DRAFT */
exports.updatePurchaseOrder = async (req, res) => {
  try {
    const po = await runInTransaction(async () => {
      const doc = await loadDraft(req.params.id);
      const parsed = parsePo(req.body);
      await resolveRefs(parsed);
      const before = await audit.snap('purchaseOrder', [doc]);
      fillPo(doc, parsed, await getSettings());
      if (req.body.issue === true) issue(doc, req);
      doc.updatedDate = new Date();
      doc.updatedBy = req.user._id;
      await doc.save();
      await audit.logUpdate(req, 'purchaseOrder', before, [doc]);
      return doc;
    });
    return successResponse(res, po, `${po.no} ${po.status === 'OPEN' ? 'issued' : 'successfully updated'}`);
  } catch (error) {
    return handleError(res, error);
  }
};

/** POST /api/purchase-order/:id/issue — terbitkan draft tanpa perubahan isi */
exports.issuePurchaseOrder = async (req, res) => {
  try {
    const po = await runInTransaction(async () => {
      const doc = await loadDraft(req.params.id);
      // validasi ulang referensi (vendor/gudang/SKU bisa berubah sejak draft disimpan)
      const parsed = parsePo({ ...doc.toObject({ depopulate: true }), lines: doc.lines.map((l) => l.toObject()) });
      await resolveRefs(parsed);
      const before = await audit.snap('purchaseOrder', [doc]);
      const settings = await getSettings();
      doc.isPKP = settings['tax.isPKP'] !== false;
      issue(doc, req);
      await doc.save();
      await audit.logUpdate(req, 'purchaseOrder', before, [doc]);
      return doc;
    });
    return successResponse(res, po, `${po.no} issued`);
  } catch (error) {
    return handleError(res, error);
  }
};

// DELETE /api/purchase-order/:id — hanya DRAFT
exports.deletePurchaseOrder = async (req, res) => {
  try {
    const po = await runInTransaction(async () => {
      const doc = await loadDraft(req.params.id);
      const before = await audit.snap('purchaseOrder', [doc]);
      await doc.deleteOne();
      await audit.logDelete(req, 'purchaseOrder', before);
      return doc;
    });
    return successResponse(res, po, `${po.no} successfully deleted`);
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- cancel / close

/** Draft GR untuk PO ini harus dihapus dulu (kunci PO: bentrok dengan pembuatan GR) */
const assertNoDraftReceipt = async (po) => {
  await lock(ref('purchaseOrder', po._id));
  const drafts = await GoodsReceipt.find({ purchaseOrder: po._id, status: 'DRAFT' }).select('no').lean();
  if (drafts.length) {
    throw new HttpError(`Delete or post the draft goods receipt(s) first: ${drafts.map((d) => d.no).join(', ')}`, 400);
  }
};

/** POST /api/purchase-order/:id/cancel  body: { reason } — hanya OPEN (belum ada barang diterima) */
exports.cancelPurchaseOrder = async (req, res) => {
  try {
    const reason = trimText(req.body.reason);
    if (!reason) return errorResponse(res, 'Cancellation reason is required', 400);
    const po = await runInTransaction(async () => {
      const doc = await PurchaseOrder.findById(req.params.id);
      if (!doc) throw new HttpError('Purchase order not found', 404);
      if (doc.status !== 'OPEN') {
        throw new HttpError(doc.status === 'PARTIAL'
          ? 'Some goods have already been received. Close the PO instead.'
          : `PO is ${doc.status.toLowerCase()} and cannot be cancelled`, 400);
      }
      await assertNoDraftReceipt(doc);
      const before = await audit.snap('purchaseOrder', [doc]);
      doc.status = 'CANCELLED';
      doc.cancelReason = reason;
      doc.cancelledBy = req.user._id;
      doc.cancelledDate = new Date();
      await doc.save();
      await audit.logUpdate(req, 'purchaseOrder', before, [doc]);
      return doc;
    });
    return successResponse(res, po, `${po.no} cancelled`);
  } catch (error) {
    return handleError(res, error);
  }
};

/** POST /api/purchase-order/:id/close  body: { reason } — PARTIAL: sisa barang tidak akan datang */
exports.closePurchaseOrder = async (req, res) => {
  try {
    const reason = trimText(req.body.reason);
    if (!reason) return errorResponse(res, 'Reason is required', 400);
    const po = await runInTransaction(async () => {
      const doc = await PurchaseOrder.findById(req.params.id);
      if (!doc) throw new HttpError('Purchase order not found', 404);
      if (doc.status !== 'PARTIAL') {
        throw new HttpError(doc.status === 'OPEN'
          ? 'Nothing has been received yet. Cancel the PO instead.'
          : `PO is ${doc.status.toLowerCase()} and cannot be closed`, 400);
      }
      await assertNoDraftReceipt(doc);
      const before = await audit.snap('purchaseOrder', [doc]);
      doc.status = 'CLOSED';
      doc.closeReason = reason;
      doc.closedBy = req.user._id;
      doc.closedDate = new Date();
      await doc.save();
      await audit.logUpdate(req, 'purchaseOrder', before, [doc]);
      return doc;
    });
    return successResponse(res, po, `${po.no} closed`);
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * Buat draft PO di DALAM transaksi yang sedang berjalan (dipakai mis. "Create PO" dari Reorder).
 * body sama dengan POST /api/purchase-order (tanpa issue). Return dokumen PO.
 */
exports.createDraftPoInTransaction = async (req, body) => {
  const parsed = parsePo(body);
  await resolveRefs(parsed);
  const doc = new PurchaseOrder({ no: await nextDocNo('PO'), createdBy: req.user._id });
  fillPo(doc, parsed, await getSettings());
  await doc.save();
  await audit.logCreate(req, 'purchaseOrder', [doc]);
  return doc;
};
