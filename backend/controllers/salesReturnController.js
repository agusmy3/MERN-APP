const mongoose = require('mongoose');
const SalesReturn = require('../models/SalesReturn');
const SalesInvoice = require('../models/SalesInvoice');
const Customer = require('../models/Customer');
const ProdukSku = require('../models/ProdukSku');
const Gudang = require('../models/Gudang');
const { hasPermission } = require('../config/permissions');
const { successResponse, errorResponse } = require('../helpers/responseHelper');
const audit = require('../helpers/auditLogger');
const { runInTransaction, HttpError, lock, ref } = require('../helpers/transaction');
const { applyMovements, nextDocNo } = require('../helpers/stockHelper');
const { checkAmount, round2 } = require('../helpers/number');
const { returnLineValues, invoiceBalance } = require('../helpers/salesHelper');
const { assertGudang, applyGudangFilter } = require('../helpers/gudangAccess');

const STATUSES = ['DRAFT', 'POSTED', 'CANCELLED'];
const SORTABLE_FIELDS = ['no', 'date', 'total', 'createdDate', 'updatedDate', 'postedDate'];

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

/** Validasi body (murni): { salesInvoice, date, reason, lines: [{ sku, qty, note }] } */
const parseReturn = (body) => {
  if (!mongoose.isValidObjectId(body.salesInvoice)) throw new HttpError('Please select a sales invoice', 400);
  const date = body.date ? new Date(body.date) : new Date();
  if (Number.isNaN(date.getTime())) throw new HttpError('Invalid return date', 400);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  if (date > endOfToday) throw new HttpError('Return date cannot be in the future', 400);
  const reason = trimText(body.reason);
  if (!reason) throw new HttpError('Return reason is required', 400);

  const seen = new Set();
  const lines = (Array.isArray(body.lines) ? body.lines : [])
    .filter((l) => !(l?.qty === '' || l?.qty === null || l?.qty === undefined || Number(l.qty) === 0))
    .map((l, i) => {
      const n = `Line ${i + 1}`;
      if (!mongoose.isValidObjectId(l?.sku)) throw new HttpError(`${n}: invalid SKU`, 400);
      if (seen.has(String(l.sku))) throw new HttpError(`${n}: the same SKU appears more than once`, 400);
      seen.add(String(l.sku));
      const err = checkAmount(l.qty, 'Quantity', { min: 0, exclusive: true });
      if (err) throw new HttpError(`${n}: ${err}`, 400);
      return { sku: String(l.sku), qty: round2(l.qty), note: trimText(l.note, 200) || undefined };
    });
  if (!lines.length) throw new HttpError('Fill in the returned quantity for at least one item', 400);
  return { salesInvoice: String(body.salesInvoice), date, reason, lines };
};

/**
 * Invoice sumber (terkunci) + isi baris retur dari baris invoice: produk, unitCost, nilai.
 * Qty <= terjual - sudah diretur (retur POSTED). `ignoreDraftId` tidak relevan: hanya POSTED yang dihitung.
 */
const loadInvoiceFor = async (req, invoiceId) => {
  await lock(ref('salesInvoice', invoiceId)); // serialisasi dengan retur / pembatalan / pembayaran lain
  const inv = await SalesInvoice.findById(invoiceId);
  if (!inv) throw new HttpError('Sales invoice not found', 404);
  assertGudang(req, inv.gudang);
  if (inv.status !== 'POSTED') throw new HttpError('Only posted invoices can be returned', 400);
  return inv;
};

const fillLines = async (inv, lines) => {
  const byLine = new Map(inv.lines.map((l) => [String(l.sku), l]));
  const codes = new Map((await ProdukSku.find({ _id: { $in: lines.map((l) => l.sku) } }).select('sku').lean())
    .map((s) => [String(s._id), s.sku]));
  for (const l of lines) {
    const il = byLine.get(l.sku);
    const code = codes.get(l.sku) || 'Item';
    if (!il) throw new HttpError(`${code} is not on invoice ${inv.no}`, 400);
    const max = returnable(il);
    if (l.qty > max) throw new HttpError(`${code}: return ${fmt(l.qty)} exceeds the returnable quantity ${fmt(max)}`, 400);
    l.produk = il.produk;
    l.unitCost = il.unitCost ?? null;
    Object.assign(l, returnLineValues(il, l.qty, inv));
  }
};

const sumTotals = (lines) => {
  const subtotal = round2(lines.reduce((s, l) => s + l.subtotal, 0));
  const total = round2(lines.reduce((s, l) => s + l.amount, 0));
  const dpp = round2(lines.reduce((s, l) => s + l.netAmount, 0));
  return { subtotal, total, dpp, taxAmount: round2(total - dpp) };
};

const populateDoc = (query) => query
  .populate('salesInvoice', 'no date total returnedAmount paidAmount paymentStatus status')
  .populate('customer', 'code name')
  .populate('gudang', 'code name')
  .populate('lines.sku', 'sku variantValues isActive')
  .populate({ path: 'lines.produk', select: 'name uom', populate: { path: 'uom', select: 'code' } })
  .populate('createdBy', 'name')
  .populate('updatedBy', 'name')
  .populate('postedBy', 'name')
  .populate('cancelledBy', 'name');

const loadDoc = async (id) => {
  if (!mongoose.isValidObjectId(id)) throw new HttpError('Sales return not found', 404);
  const doc = await SalesReturn.findById(id);
  if (!doc) throw new HttpError('Sales return not found', 404);
  return doc;
};

const loadDraft = async (req, id) => {
  const doc = await loadDoc(id);
  assertGudang(req, doc.gudang);
  if (doc.status !== 'DRAFT') throw new HttpError(`Return is already ${doc.status.toLowerCase()} and can no longer be changed`, 400);
  return doc;
};

const stripCost = (req, doc) => {
  if (canSeeCostOf(req)) return;
  delete doc.cogs;
  (doc.lines || []).forEach((l) => { delete l.unitCost; });
};

// ---------------------------------------------------------------- baca

/** GET /api/sales-return — filter search (no / alasan / invoice / customer), status, customer, gudang, from, to */
exports.getReturns = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || 1) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || 10) || 10, 1), 100);
    const sortField = SORTABLE_FIELDS.includes(req.query.sortField) ? req.query.sortField : 'createdDate';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const filter = {};
    if (req.query.search) {
      const rx = { $regex: escapeRegex(req.query.search), $options: 'i' };
      const [customers, invoices] = await Promise.all([
        Customer.find({ $or: [{ name: rx }, { code: rx }] }).distinct('_id'),
        SalesInvoice.find({ no: rx }).distinct('_id'),
      ]);
      filter.$or = [{ no: rx }, { reason: rx }, { customer: { $in: customers } }, { salesInvoice: { $in: invoices } }];
    }
    if (STATUSES.includes(req.query.status)) filter.status = req.query.status;
    for (const key of ['customer', 'salesInvoice']) {
      if (!req.query[key]) continue;
      if (!mongoose.isValidObjectId(req.query[key])) return errorResponse(res, `Invalid ${key}`, 400);
      filter[key] = req.query[key];
    }
    if (req.query.gudang && !mongoose.isValidObjectId(req.query.gudang)) return errorResponse(res, 'Invalid warehouse', 400);
    applyGudangFilter(req, filter, req.query.gudang);
    if (req.query.from || req.query.to) {
      const date = {};
      if (req.query.from) date.$gte = new Date(`${req.query.from}T00:00:00`);
      if (req.query.to) date.$lte = new Date(`${req.query.to}T23:59:59.999`);
      if (Object.values(date).some((d) => Number.isNaN(d.getTime()))) return errorResponse(res, 'Invalid date', 400);
      filter.date = date;
    }
    const [totalData, docs] = await Promise.all([
      SalesReturn.countDocuments(filter),
      SalesReturn.find(filter)
        .select('-lines')
        .populate('salesInvoice', 'no')
        .populate('customer', 'code name')
        .populate('gudang', 'code name')
        .populate('createdBy', 'name')
        .populate('updatedBy', 'name')
        .sort({ [sortField]: sortOrder, _id: sortOrder })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);
    const counts = await SalesReturn.aggregate([
      { $match: { _id: { $in: docs.map((d) => d._id) } } },
      { $project: { lineCount: { $size: '$lines' }, qty: { $sum: '$lines.qty' } } },
    ]);
    const countMap = new Map(counts.map((c) => [String(c._id), c]));
    docs.forEach((d) => {
      d.lineCount = countMap.get(String(d._id))?.lineCount || 0;
      d.totalQty = round2(countMap.get(String(d._id))?.qty || 0);
      stripCost(req, d);
    });
    return successResponse(res, { dataSalesReturn: docs, canSeeCost: canSeeCostOf(req), totalData, currentPage: page, totalPages: Math.ceil(totalData / pageSize) });
  } catch (error) {
    return handleError(res, error);
  }
};

/** GET /api/sales-return/:id — + sold / returned / returnable per baris dari invoice */
exports.getReturn = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 'Sales return not found', 404);
    const doc = await populateDoc(SalesReturn.findById(req.params.id)).lean();
    if (!doc) return errorResponse(res, 'Sales return not found', 404);
    assertGudang(req, doc.gudang?._id ?? doc.gudang);
    const inv = await SalesInvoice.findById(doc.salesInvoice?._id).select('lines').lean();
    const byLine = new Map((inv?.lines || []).map((l) => [String(l.sku), l]));
    doc.lines.forEach((l) => {
      const il = byLine.get(String(l.sku?._id ?? l.sku));
      l.sold = il?.qty ?? null;
      l.returned = il?.qtyReturned ?? null;
      l.returnable = il ? returnable(il) : null;
    });
    doc.canSeeCost = canSeeCostOf(req);
    stripCost(req, doc);
    return successResponse(res, doc);
  } catch (error) {
    return handleError(res, error);
  }
};

/** GET /api/sales-return/invoice-options?search= — invoice POSTED (gudang yang boleh diakses) yang masih bisa diretur */
exports.getInvoiceOptions = async (req, res) => {
  try {
    const filter = applyGudangFilter(req, { status: 'POSTED' });
    if (req.query.search) {
      const rx = { $regex: escapeRegex(req.query.search), $options: 'i' };
      const customers = await Customer.find({ name: rx }).distinct('_id');
      filter.$or = [{ no: rx }, { customer: { $in: customers } }];
    }
    filter.$expr = { $anyElementTrue: { $map: { input: '$lines', as: 'l', in: { $lt: [{ $ifNull: ['$$l.qtyReturned', 0] }, '$$l.qty'] } } } };
    const invoices = await SalesInvoice.find(filter)
      .select('no date total customer gudang')
      .populate('customer', 'name')
      .populate('gudang', 'code')
      .sort({ date: -1, _id: -1 })
      .limit(20)
      .lean();
    return successResponse(res, invoices);
  } catch (error) {
    return handleError(res, error);
  }
};

/** GET /api/sales-return/from-invoice/:invoiceId — baris invoice + qty yang masih bisa diretur & nilai per unit */
exports.getInvoiceForReturn = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.invoiceId)) return errorResponse(res, 'Invalid sales invoice', 400);
    const inv = await SalesInvoice.findById(req.params.invoiceId)
      .select('no date status customer gudang lines subtotal dpp total')
      .populate('customer', 'code name')
      .populate('gudang', 'code name')
      .populate('lines.sku', 'sku variantValues isActive')
      .populate({ path: 'lines.produk', select: 'name uom', populate: { path: 'uom', select: 'code' } })
      .lean();
    if (!inv) return errorResponse(res, 'Sales invoice not found', 404);
    assertGudang(req, inv.gudang?._id);
    if (inv.status !== 'POSTED') return errorResponse(res, 'Only posted invoices can be returned', 400);
    inv.lines.forEach((l) => {
      l.returnable = returnable(l);
      l.unitAmount = returnLineValues(l, 1, inv).amount; // nilai retur per unit (termasuk PPN)
      delete l.unitCost;
    });
    return successResponse(res, inv);
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- draft

exports.createReturn = async (req, res) => {
  try {
    const parsed = parseReturn(req.body);
    const doc = await runInTransaction(async () => {
      const inv = await loadInvoiceFor(req, parsed.salesInvoice);
      await fillLines(inv, parsed.lines);
      const doc = await SalesReturn.create({
        ...parsed,
        ...sumTotals(parsed.lines),
        no: await nextDocNo('RTN'),
        customer: inv.customer,
        gudang: inv.gudang,
        status: 'DRAFT',
        createdBy: req.user._id,
      });
      await audit.logCreate(req, 'salesReturn', [doc]);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} saved as draft`, 201);
  } catch (error) {
    return handleError(res, error);
  }
};

exports.updateReturn = async (req, res) => {
  try {
    const doc = await runInTransaction(async () => {
      const doc = await loadDraft(req, req.params.id);
      const parsed = parseReturn({ ...req.body, salesInvoice: String(doc.salesInvoice) }); // invoice tidak bisa diganti
      const inv = await loadInvoiceFor(req, parsed.salesInvoice);
      await fillLines(inv, parsed.lines);
      const before = await audit.snap('salesReturn', [doc]);
      Object.assign(doc, { date: parsed.date, reason: parsed.reason, lines: parsed.lines, ...sumTotals(parsed.lines) });
      doc.updatedDate = new Date();
      doc.updatedBy = req.user._id;
      await doc.save();
      await audit.logUpdate(req, 'salesReturn', before, [doc]);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} successfully updated`);
  } catch (error) {
    return handleError(res, error);
  }
};

exports.deleteReturn = async (req, res) => {
  try {
    const doc = await runInTransaction(async () => {
      const doc = await loadDoc(req.params.id);
      assertGudang(req, doc.gudang);
      if (doc.status !== 'DRAFT') throw new HttpError('Only draft returns can be deleted. Cancel a posted return instead.', 400);
      const before = await audit.snap('salesReturn', [doc]);
      await doc.deleteOne();
      await audit.logDelete(req, 'salesReturn', before);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} successfully deleted`);
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- post / batal (izin 'post')

/**
 * POST /api/sales-return/:id/post — stok masuk kembali (SALE_RETURN, HPP saat dijual), qty & nilai
 * retur dicatat di invoice (tagihan berkurang). Retur yang menghabiskan seluruh invoice memakai sisa
 * nilai invoice (tanpa selisih pembulatan).
 */
exports.postReturn = async (req, res) => {
  try {
    const doc = await runInTransaction(async () => {
      const doc = await loadDraft(req, req.params.id);
      const inv = await loadInvoiceFor(req, doc.salesInvoice);
      await lock(ref('gudang', doc.gudang));
      if (!(await Gudang.exists({ _id: doc.gudang }))) throw new HttpError('Warehouse no longer exists', 400);
      const lines = doc.lines.map((l) => ({ sku: String(l.sku), qty: l.qty, note: l.note }));
      await fillLines(inv, lines); // validasi ulang qty (retur lain bisa sudah diposting)

      const before = await audit.snap('salesReturn', [doc]);
      const invBefore = await audit.snap('salesInvoice', [inv]);
      await applyMovements(req, lines.map((l) => ({
        sku: l.sku,
        gudang: doc.gudang,
        qty: l.qty,
        unitCost: l.unitCost,
        type: 'SALE_RETURN',
        note: l.note || doc.reason,
      })), { refType: 'SalesReturn', refId: doc._id, refNo: doc.no });

      const qtyOf = new Map(lines.map((l) => [l.sku, l.qty]));
      inv.lines.forEach((l) => { l.qtyReturned = round2((l.qtyReturned || 0) + (qtyOf.get(String(l.sku)) || 0)); });
      const totals = sumTotals(lines);
      if (inv.lines.every((l) => l.qtyReturned >= l.qty)) {
        // retur terakhir: pakai sisa nilai invoice supaya total retur = total invoice persis
        const prev = await SalesReturn.aggregate([
          { $match: { salesInvoice: inv._id, status: 'POSTED' } },
          { $group: { _id: null, total: { $sum: '$total' }, dpp: { $sum: '$dpp' } } },
        ]);
        totals.total = round2(inv.total - (prev[0]?.total || 0));
        totals.dpp = round2(inv.dpp - (prev[0]?.dpp || 0));
        totals.taxAmount = round2(totals.total - totals.dpp);
      }
      Object.assign(doc, { lines, ...totals });
      doc.cogs = round2(lines.reduce((s, l) => s + l.qty * (l.unitCost || 0), 0));
      doc.status = 'POSTED';
      doc.postedBy = req.user._id;
      doc.postedDate = new Date();
      await doc.save();

      inv.returnedAmount = round2((inv.returnedAmount || 0) + doc.total);
      inv.paymentStatus = invoiceBalance(inv).paymentStatus;
      await inv.save();
      await audit.logUpdate(req, 'salesReturn', before, [doc]);
      await audit.logUpdate(req, 'salesInvoice', invBefore, [inv]);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} posted`);
  } catch (error) {
    return handleError(res, error);
  }
};

/** POST /api/sales-return/:id/cancel { reason } — hanya POSTED: stok keluar lagi, retur di invoice dikurangi */
exports.cancelReturn = async (req, res) => {
  try {
    const cancelReason = trimText(req.body.reason);
    if (!cancelReason) return errorResponse(res, 'Cancellation reason is required', 400);
    const doc = await runInTransaction(async () => {
      const doc = await loadDoc(req.params.id);
      assertGudang(req, doc.gudang);
      if (doc.status !== 'POSTED') {
        throw new HttpError(doc.status === 'DRAFT' ? 'Draft returns are deleted, not cancelled' : 'Return is already cancelled', 400);
      }
      await lock(ref('salesInvoice', doc.salesInvoice), ref('gudang', doc.gudang));
      const inv = await SalesInvoice.findById(doc.salesInvoice);
      if (!inv) throw new HttpError('Sales invoice no longer exists', 400);

      const before = await audit.snap('salesReturn', [doc]);
      const invBefore = await audit.snap('salesInvoice', [inv]);
      await applyMovements(req, doc.lines.map((l) => ({
        sku: l.sku,
        gudang: doc.gudang,
        qty: -l.qty,
        unitCost: l.unitCost,
        type: 'SALE_RETURN',
        note: `Cancelled: ${cancelReason}`,
      })), { refType: 'SalesReturn', refId: doc._id, refNo: doc.no, isReversal: true });

      const qtyOf = new Map(doc.lines.map((l) => [String(l.sku), l.qty]));
      inv.lines.forEach((l) => { l.qtyReturned = Math.max(round2((l.qtyReturned || 0) - (qtyOf.get(String(l.sku)) || 0)), 0); });
      inv.returnedAmount = Math.max(round2((inv.returnedAmount || 0) - doc.total), 0);
      inv.paymentStatus = invoiceBalance(inv).paymentStatus;
      await inv.save();

      doc.status = 'CANCELLED';
      doc.cancelledBy = req.user._id;
      doc.cancelledDate = new Date();
      doc.cancelReason = cancelReason;
      await doc.save();
      await audit.logUpdate(req, 'salesReturn', before, [doc]);
      await audit.logUpdate(req, 'salesInvoice', invBefore, [inv]);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} cancelled`);
  } catch (error) {
    return handleError(res, error);
  }
};
