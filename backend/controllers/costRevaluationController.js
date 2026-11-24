const mongoose = require('mongoose');
const CostRevaluation = require('../models/CostRevaluation');
const ProdukSku = require('../models/ProdukSku');
const Produk = require('../models/Produk');
const StockBalance = require('../models/StockBalance');
const StockMovement = require('../models/StockMovement');
const { successResponse, errorResponse } = require('../helpers/responseHelper');
const audit = require('../helpers/auditLogger');
const { runInTransaction, HttpError, lock, ref } = require('../helpers/transaction');
const { nextDocNo } = require('../helpers/stockHelper');
const { checkAmount, round2 } = require('../helpers/number');
const { MAX_LINES } = require('../config/stock');

const STATUSES = ['DRAFT', 'POSTED', 'CANCELLED'];
const SORTABLE_FIELDS = ['no', 'date', 'createdDate', 'updatedDate', 'postedDate'];

const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status);
  if (error.name === 'ValidationError' || error.name === 'CastError') return errorResponse(res, error.message, 400);
  return errorResponse(res, error.message, 500);
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const trimText = (v, max = 500) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));
const fmt = (n) => (n === null || n === undefined ? 'none' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }));

const parseDocument = (body) => {
  const date = body.date ? new Date(body.date) : new Date();
  if (Number.isNaN(date.getTime())) throw new HttpError('Invalid document date', 400);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  if (date > endOfToday) throw new HttpError('Document date cannot be in the future', 400);

  const note = trimText(body.note);
  if (!note) throw new HttpError('Reason is required', 400);

  const input = Array.isArray(body.lines) ? body.lines : [];
  if (!input.length) throw new HttpError('Add at least one SKU line', 400);
  if (input.length > MAX_LINES) throw new HttpError(`A document can have at most ${MAX_LINES} lines`, 400);
  const seen = new Set();
  const lines = input.map((l, i) => {
    const n = `Line ${i + 1}`;
    if (!mongoose.isValidObjectId(l?.sku)) throw new HttpError(`${n}: invalid SKU`, 400);
    if (seen.has(String(l.sku))) throw new HttpError(`${n}: the same SKU appears more than once`, 400);
    seen.add(String(l.sku));
    const err = checkAmount(l.newCost, 'New cost');
    if (err) throw new HttpError(`${n}: ${err}`, 400);
    return { sku: String(l.sku), newCost: round2(l.newCost), oldCost: null, qty: null, valueChange: null, note: trimText(l.note, 200) || undefined };
  });
  return { date, note, lines };
};

/** SKU harus ada; kunci produk (bentrok dengan hapus SKU/produk). Mengisi line.produk. */
const resolveRefs = async (parsed) => {
  const skus = await ProdukSku.find({ _id: { $in: parsed.lines.map((l) => l.sku) } }).select('produk').lean();
  await lock([...new Set(skus.map((s) => String(s.produk)))].map((id) => ref('produk', id)));
  if (skus.length !== parsed.lines.length) throw new HttpError('One or more SKUs no longer exist', 400);
  const produkOf = new Map(skus.map((s) => [String(s._id), s.produk]));
  parsed.lines.forEach((l) => { l.produk = produkOf.get(l.sku); });
};

/**
 * Terapkan HPP baru ke SKU (di dalam transaksi) + movement REVALUATION per gudang yang ada saldonya.
 * entries: [{ sku, from, to }] — from = HPP lama (boleh null), to = HPP baru (boleh null saat dibatalkan).
 * -> Map skuId -> { qty, valueChange }
 */
const applyRevaluation = async (req, entries, { refId, refNo, isReversal = false, note }) => {
  const now = new Date();
  const result = new Map();
  const movements = [];
  for (const e of entries) {
    const sku = await ProdukSku.findById(e.sku).select('sku produk stok avgCost');
    if (!sku) throw new HttpError('One or more SKUs no longer exist', 400);
    sku.avgCost = e.to;
    await sku.save(); // menulis dokumen SKU -> bentrok dengan GR / adjustment bersamaan (diulang)

    const delta = round2((e.to ?? 0) - (e.from ?? 0));
    const balances = await StockBalance.find({ sku: sku._id, qty: { $ne: 0 } }).select('gudang qty').lean();
    balances.forEach((b) => movements.push({
      sku: sku._id,
      produk: sku.produk,
      gudang: b.gudang,
      type: 'REVALUATION',
      qty: 0,
      balanceAfter: b.qty,
      refType: 'CostRevaluation',
      refId,
      refNo,
      reason: null,
      note,
      isReversal,
      unitCost: e.to,
      value: round2(b.qty * delta),
      avgCostAfter: e.to,
      createdBy: req.user?._id ?? null,
      date: now,
    }));
    result.set(String(sku._id), { qty: sku.stok || 0, valueChange: round2((sku.stok || 0) * delta) });
  }
  if (movements.length) await StockMovement.insertMany(movements);
  return result;
};

const populateDoc = (query) => query
  .populate('lines.sku', 'sku variantValues isActive stok avgCost')
  .populate({ path: 'lines.produk', select: 'name uom', populate: { path: 'uom', select: 'code' } })
  .populate('createdBy', 'name')
  .populate('updatedBy', 'name')
  .populate('postedBy', 'name')
  .populate('cancelledBy', 'name');

// ---------------------------------------------------------------- baca

exports.getRevaluations = async (req, res) => {
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
    if (STATUSES.includes(req.query.status)) filter.status = req.query.status;
    if (req.query.from || req.query.to) {
      filter.date = {};
      if (req.query.from) filter.date.$gte = new Date(`${req.query.from}T00:00:00`);
      if (req.query.to) filter.date.$lte = new Date(`${req.query.to}T23:59:59.999`);
      if (Object.values(filter.date).some((d) => Number.isNaN(d.getTime()))) return errorResponse(res, 'Invalid date', 400);
    }
    const [totalData, docs] = await Promise.all([
      CostRevaluation.countDocuments(filter),
      CostRevaluation.find(filter)
        .populate('createdBy', 'name')
        .populate('updatedBy', 'name')
        .sort({ [sortField]: sortOrder, _id: sortOrder })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);
    docs.forEach((d) => {
      d.lineCount = d.lines.length;
      d.totalValueChange = d.status === 'DRAFT' ? null : round2(d.lines.reduce((s, l) => s + (l.valueChange || 0), 0));
      delete d.lines;
    });
    return successResponse(res, { dataCostRevaluation: docs, totalData, currentPage: page, totalPages: Math.ceil(totalData / pageSize) });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.getRevaluation = async (req, res) => {
  try {
    const doc = await populateDoc(CostRevaluation.findById(req.params.id)).lean();
    if (!doc) return errorResponse(res, 'Cost revaluation not found', 404);
    // draft: kondisi SKU saat ini (stok & HPP) untuk pratinjau
    doc.lines.forEach((l) => {
      if (doc.status === 'DRAFT') {
        l.qty = l.sku?.stok ?? 0;
        l.oldCost = l.sku?.avgCost ?? null;
        l.valueChange = round2(l.qty * (l.newCost - (l.oldCost ?? 0)));
      }
    });
    return successResponse(res, doc);
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * GET /api/cost-revaluation/skus?search=|produk=|kategori=|missingOnly=true
 * SKU + stok total & HPP saat ini. missingOnly = SKU berstok tanpa HPP (semua, untuk dilengkapi).
 */
exports.searchSkus = async (req, res) => {
  try {
    const { search, produk, kategori } = req.query;
    const filter = {};
    let limit = 20;
    if (req.query.missingOnly === 'true') {
      filter.stok = { $gt: 0 };
      filter.$or = [{ avgCost: null }, { avgCost: { $exists: false } }];
      limit = MAX_LINES;
    } else if (produk || kategori) {
      if (produk && !mongoose.isValidObjectId(produk)) return errorResponse(res, 'Invalid product', 400);
      if (kategori && !mongoose.isValidObjectId(kategori)) return errorResponse(res, 'Invalid category', 400);
      filter.produk = produk ? produk : { $in: await Produk.find({ kategori }).distinct('_id') };
      limit = MAX_LINES;
    } else if (search && String(search).trim()) {
      const rx = { $regex: escapeRegex(String(search).trim()), $options: 'i' };
      filter.$or = [{ sku: rx }, { produk: { $in: await Produk.find({ name: rx }).distinct('_id') } }];
    } else {
      return successResponse(res, []);
    }
    const skus = await ProdukSku.find(filter)
      .select('sku produk variantValues isActive stok avgCost')
      .populate({ path: 'produk', select: 'name uom', populate: { path: 'uom', select: 'code' } })
      .sort({ sku: 1 })
      .limit(limit)
      .lean();
    return successResponse(res, skus.map((s) => ({
      _id: s._id,
      sku: s.sku,
      isActive: s.isActive !== false,
      variant: (s.variantValues || []).map((v) => v.value).join(' / ') || 'Default',
      produk: s.produk ? { _id: s.produk._id, name: s.produk.name } : null,
      uom: s.produk?.uom?.code || '',
      qty: s.stok || 0,
      avgCost: s.avgCost ?? null,
    })));
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- draft

exports.createRevaluation = async (req, res) => {
  try {
    const parsed = parseDocument(req.body);
    const doc = await runInTransaction(async () => {
      await resolveRefs(parsed);
      const doc = await CostRevaluation.create({ ...parsed, no: await nextDocNo('REV'), status: 'DRAFT', createdBy: req.user._id });
      await audit.logCreate(req, 'costRevaluation', [doc]);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} saved as draft`, 201);
  } catch (error) {
    return handleError(res, error);
  }
};

const loadDraft = async (id) => {
  const doc = await CostRevaluation.findById(id);
  if (!doc) throw new HttpError('Cost revaluation not found', 404);
  if (doc.status !== 'DRAFT') throw new HttpError(`Document is already ${doc.status.toLowerCase()} and can no longer be changed`, 400);
  return doc;
};

exports.updateRevaluation = async (req, res) => {
  try {
    const doc = await runInTransaction(async () => {
      const doc = await loadDraft(req.params.id);
      const parsed = parseDocument(req.body);
      await resolveRefs(parsed);
      const before = await audit.snap('costRevaluation', [doc]);
      doc.date = parsed.date;
      doc.note = parsed.note;
      doc.lines = parsed.lines;
      doc.updatedDate = new Date();
      doc.updatedBy = req.user._id;
      await doc.save();
      await audit.logUpdate(req, 'costRevaluation', before, [doc]);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} successfully updated`);
  } catch (error) {
    return handleError(res, error);
  }
};

exports.deleteRevaluation = async (req, res) => {
  try {
    const doc = await runInTransaction(async () => {
      const doc = await loadDraft(req.params.id);
      const before = await audit.snap('costRevaluation', [doc]);
      await doc.deleteOne();
      await audit.logDelete(req, 'costRevaluation', before);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} successfully deleted`);
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- post & cancel (izin 'post')

/** POST /api/cost-revaluation/:id/post — HPP baru diterapkan; HPP lama, stok & selisih nilai dicatat per baris */
exports.postRevaluation = async (req, res) => {
  try {
    const doc = await runInTransaction(async () => {
      const doc = await loadDraft(req.params.id);
      const before = await audit.snap('costRevaluation', [doc]);
      const skus = await ProdukSku.find({ _id: { $in: doc.lines.map((l) => l.sku) } }).select('avgCost').lean();
      const current = new Map(skus.map((s) => [String(s._id), s.avgCost ?? null]));
      if (skus.length !== doc.lines.length) throw new HttpError('One or more SKUs no longer exist', 400);

      doc.lines.forEach((l) => { l.oldCost = current.get(String(l.sku)); });
      const result = await applyRevaluation(req, doc.lines.map((l) => ({ sku: l.sku, from: l.oldCost, to: l.newCost })), {
        refId: doc._id, refNo: doc.no, note: doc.note,
      });
      doc.lines.forEach((l) => {
        const r = result.get(String(l.sku));
        l.qty = r.qty;
        l.valueChange = r.valueChange;
      });
      doc.status = 'POSTED';
      doc.postedBy = req.user._id;
      doc.postedDate = new Date();
      await doc.save();
      await audit.logUpdate(req, 'costRevaluation', before, [doc]);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} successfully posted`);
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * POST /api/cost-revaluation/:id/cancel  body: { reason }
 * HPP dikembalikan ke nilai sebelum revaluasi. Ditolak jika HPP SKU sudah berubah lagi sejak itu
 * (mis. ada penerimaan barang): buat revaluasi baru.
 */
exports.cancelRevaluation = async (req, res) => {
  try {
    const reason = trimText(req.body.reason);
    if (!reason) return errorResponse(res, 'Cancellation reason is required', 400);
    const doc = await runInTransaction(async () => {
      const doc = await CostRevaluation.findById(req.params.id);
      if (!doc) throw new HttpError('Cost revaluation not found', 404);
      if (doc.status !== 'POSTED') throw new HttpError('Only posted documents can be cancelled', 400);

      const skus = await ProdukSku.find({ _id: { $in: doc.lines.map((l) => l.sku) } }).select('sku avgCost').lean();
      const changed = skus.filter((s) => {
        const line = doc.lines.find((l) => String(l.sku) === String(s._id));
        return (s.avgCost ?? null) !== line.newCost;
      });
      if (changed.length) {
        throw new HttpError(`HPP has changed since this revaluation (${changed.map((s) => `${s.sku}: ${fmt(s.avgCost)}`).join(', ')}). Create a new revaluation instead.`, 400);
      }

      const before = await audit.snap('costRevaluation', [doc]);
      await applyRevaluation(req, doc.lines.map((l) => ({ sku: l.sku, from: l.newCost, to: l.oldCost })), {
        refId: doc._id, refNo: doc.no, isReversal: true, note: `Cancelled: ${reason}`,
      });
      doc.status = 'CANCELLED';
      doc.cancelReason = reason;
      doc.cancelledBy = req.user._id;
      doc.cancelledDate = new Date();
      await doc.save();
      await audit.logUpdate(req, 'costRevaluation', before, [doc]);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} cancelled`);
  } catch (error) {
    return handleError(res, error);
  }
};
