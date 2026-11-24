const mongoose = require('mongoose');
const StockTransfer = require('../models/StockTransfer');
const ProdukSku = require('../models/ProdukSku');
const Gudang = require('../models/Gudang');
const { hasPermission } = require('../config/permissions');
const { successResponse, errorResponse } = require('../helpers/responseHelper');
const audit = require('../helpers/auditLogger');
const { runInTransaction, HttpError, lock, ref } = require('../helpers/transaction');
const { applyMovements, getBalances, nextDocNo } = require('../helpers/stockHelper');
const { checkAmount, round2 } = require('../helpers/number');
const { assertGudang, gudangScope } = require('../helpers/gudangAccess');
const { MAX_LINES } = require('../config/stock');

const STATUSES = ['DRAFT', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED'];
const SORTABLE_FIELDS = ['no', 'date', 'createdDate', 'updatedDate', 'sentDate', 'receivedDate'];

const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status);
  if (error.name === 'ValidationError' || error.name === 'CastError') return errorResponse(res, error.message, 400);
  return errorResponse(res, error.message, 500);
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const trimText = (v, max = 500) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));
const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

/** Validasi isi transfer dari body (murni). */
const parseTransfer = (body) => {
  if (!mongoose.isValidObjectId(body.fromGudang)) throw new HttpError('Please select the source warehouse', 400);
  if (!mongoose.isValidObjectId(body.toGudang)) throw new HttpError('Please select the destination warehouse', 400);
  if (String(body.fromGudang) === String(body.toGudang)) throw new HttpError('Source and destination warehouse must be different', 400);

  const date = body.date ? new Date(body.date) : new Date();
  if (Number.isNaN(date.getTime())) throw new HttpError('Invalid transfer date', 400);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  if (date > endOfToday) throw new HttpError('Transfer date cannot be in the future', 400);

  const input = Array.isArray(body.lines) ? body.lines : [];
  if (!input.length) throw new HttpError('Add at least one SKU line', 400);
  if (input.length > MAX_LINES) throw new HttpError(`A transfer can have at most ${MAX_LINES} lines`, 400);

  const seen = new Set();
  const lines = input.map((l, i) => {
    const n = `Line ${i + 1}`;
    if (!mongoose.isValidObjectId(l?.sku)) throw new HttpError(`${n}: invalid SKU`, 400);
    if (seen.has(String(l.sku))) throw new HttpError(`${n}: the same SKU appears more than once`, 400);
    seen.add(String(l.sku));
    const err = checkAmount(l.qty, 'Quantity', { min: 0, exclusive: true });
    if (err) throw new HttpError(`${n}: ${err}`, 400);
    return { sku: String(l.sku), qty: round2(l.qty), qtyReceived: null, unitCost: null, note: trimText(l.note, 200) || undefined };
  });

  return {
    fromGudang: String(body.fromGudang),
    toGudang: String(body.toGudang),
    date,
    note: trimText(body.note),
    lines,
  };
};

/** Referensi di dalam transaksi + kunci gudang & produk. Mengisi line.produk. */
const resolveRefs = async (parsed) => {
  const skuIds = parsed.lines.map((l) => l.sku);
  const owners = await ProdukSku.find({ _id: { $in: skuIds } }).select('produk').lean();
  await lock(
    ref('gudang', parsed.fromGudang), ref('gudang', parsed.toGudang),
    [...new Set(owners.map((s) => String(s.produk)))].map((id) => ref('produk', id))
  );
  const gudangs = await Gudang.find({ _id: { $in: [parsed.fromGudang, parsed.toGudang] } }).select('code isActive').lean();
  if (gudangs.length !== 2) throw new HttpError('Please select valid warehouses', 400);
  const inactive = gudangs.find((g) => g.isActive === false);
  if (inactive) throw new HttpError(`Warehouse ${inactive.code} is inactive`, 400);

  const skus = await ProdukSku.find({ _id: { $in: skuIds } }).select('sku produk').lean();
  if (skus.length !== skuIds.length) throw new HttpError('One or more SKUs no longer exist', 400);
  const produkOf = new Map(skus.map((s) => [String(s._id), s.produk]));
  parsed.lines.forEach((l) => { l.produk = produkOf.get(l.sku); });
};

const populateDoc = (query) => query
  .populate('fromGudang', 'code name isActive')
  .populate('toGudang', 'code name isActive')
  .populate('lines.sku', 'sku variantValues isActive')
  .populate({ path: 'lines.produk', select: 'name uom', populate: { path: 'uom', select: 'code' } })
  .populate('createdBy', 'name')
  .populate('updatedBy', 'name')
  .populate('sentBy', 'name')
  .populate('receivedBy', 'name')
  .populate('cancelledBy', 'name');

/** Boleh melihat transfer: gudang asal ATAU tujuan dalam akses user */
const assertCanSee = (req, doc) => {
  const scope = gudangScope(req);
  if (!scope) return;
  const ids = [doc.fromGudang?._id ?? doc.fromGudang, doc.toGudang?._id ?? doc.toGudang].map(String);
  if (!ids.some((id) => scope.includes(id))) throw new HttpError("You don't have access to this warehouse", 403);
};

const loadDoc = async (id) => {
  if (!mongoose.isValidObjectId(id)) throw new HttpError('Stock transfer not found', 404);
  const doc = await StockTransfer.findById(id);
  if (!doc) throw new HttpError('Stock transfer not found', 404);
  return doc;
};

// ---------------------------------------------------------------- baca

/**
 * GET /api/stock-transfer — daftar (tanpa baris)
 * Query: search, status, fromGudang, toGudang, gudang (asal ATAU tujuan), from, to, page, pageSize, sort*
 * User yang dibatasi gudang hanya melihat transfer dari/ke gudangnya.
 */
exports.getTransfers = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || 1) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || 10) || 10, 1), 100);
    const sortField = SORTABLE_FIELDS.includes(req.query.sortField) ? req.query.sortField : 'createdDate';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const and = [];

    if (req.query.search) {
      const rx = { $regex: escapeRegex(req.query.search), $options: 'i' };
      and.push({ $or: [{ no: rx }, { note: rx }] });
    }
    if (STATUSES.includes(req.query.status)) and.push({ status: req.query.status });
    for (const key of ['fromGudang', 'toGudang', 'gudang']) {
      const v = req.query[key];
      if (!v) continue;
      if (!mongoose.isValidObjectId(v)) return errorResponse(res, 'Invalid warehouse', 400);
      and.push(key === 'gudang' ? { $or: [{ fromGudang: v }, { toGudang: v }] } : { [key]: v });
    }
    const scope = gudangScope(req);
    if (scope) and.push({ $or: [{ fromGudang: { $in: scope } }, { toGudang: { $in: scope } }] });
    if (req.query.from || req.query.to) {
      const date = {};
      if (req.query.from) date.$gte = new Date(`${req.query.from}T00:00:00`);
      if (req.query.to) date.$lte = new Date(`${req.query.to}T23:59:59.999`);
      if (Object.values(date).some((d) => Number.isNaN(d.getTime()))) return errorResponse(res, 'Invalid date', 400);
      and.push({ date });
    }
    const filter = and.length ? { $and: and } : {};

    const [totalData, docs] = await Promise.all([
      StockTransfer.countDocuments(filter),
      StockTransfer.find(filter)
        .select('-lines')
        .populate('fromGudang', 'code name')
        .populate('toGudang', 'code name')
        .populate('createdBy', 'name')
        .populate('updatedBy', 'name')
        .sort({ [sortField]: sortOrder, _id: sortOrder })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);

    const stats = await StockTransfer.aggregate([
      { $match: { _id: { $in: docs.map((d) => d._id) } } },
      {
        $project: {
          lineCount: { $size: '$lines' },
          qty: { $sum: '$lines.qty' },
          qtyReceived: { $sum: '$lines.qtyReceived' },
          value: { $sum: { $map: { input: '$lines', as: 'l', in: { $multiply: ['$$l.qty', { $ifNull: ['$$l.unitCost', 0] }] } } } },
        }
      },
    ]);
    const canSeeCost = hasPermission(req.user, 'vendorPrice', 'view');
    const statMap = new Map(stats.map((s) => [String(s._id), s]));
    docs.forEach((d) => {
      const s = statMap.get(String(d._id));
      d.lineCount = s?.lineCount || 0;
      d.totalQty = round2(s?.qty || 0);
      d.totalReceived = d.status === 'RECEIVED' ? round2(s?.qtyReceived || 0) : null;
      if (canSeeCost) d.totalValue = d.status === 'DRAFT' ? null : round2(s?.value || 0);
    });

    return successResponse(res, {
      dataStockTransfer: docs,
      canSeeCost,
      totalData,
      currentPage: page,
      totalPages: Math.ceil(totalData / pageSize),
    });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * GET /api/stock-transfer/:id — dokumen lengkap.
 * Draft: + currentQty (saldo gudang asal). Biaya (unitCost, value) hanya untuk vendorPrice:view.
 * + canSend / canReceive: user boleh mengakses gudang asal / tujuan (tombol di UI).
 */
exports.getTransfer = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 'Stock transfer not found', 404);
    const doc = await populateDoc(StockTransfer.findById(req.params.id)).lean();
    if (!doc) return errorResponse(res, 'Stock transfer not found', 404);
    assertCanSee(req, doc);

    if (doc.status === 'DRAFT' && doc.fromGudang) {
      const balances = await getBalances(doc.fromGudang._id, doc.lines.map((l) => l.sku?._id).filter(Boolean));
      doc.lines.forEach((l) => { l.currentQty = l.sku ? (balances.get(String(l.sku._id)) || 0) : null; });
    }

    const scope = gudangScope(req);
    const can = (g) => !scope || (g && scope.includes(String(g._id)));
    doc.canSend = can(doc.fromGudang);     // ubah draft, kirim, batalkan
    doc.canReceive = can(doc.toGudang);    // terima

    doc.canSeeCost = hasPermission(req.user, 'vendorPrice', 'view');
    if (doc.canSeeCost) {
      if (doc.status === 'DRAFT') {
        const skus = await ProdukSku.find({ _id: { $in: doc.lines.map((l) => l.sku?._id).filter(Boolean) } }).select('avgCost').lean();
        const avg = new Map(skus.map((s) => [String(s._id), s.avgCost ?? null]));
        doc.lines.forEach((l) => { l.unitCost = l.sku ? avg.get(String(l.sku._id)) ?? null : null; }); // perkiraan
      }
      doc.lines.forEach((l) => {
        l.value = l.unitCost === null || l.unitCost === undefined ? null : round2(l.qty * l.unitCost);
        const short = l.qtyReceived === null || l.qtyReceived === undefined ? 0 : round2(l.qty - l.qtyReceived);
        l.lossValue = short > 0 && l.unitCost !== null && l.unitCost !== undefined ? round2(short * l.unitCost) : 0;
      });
      doc.totalValue = round2(doc.lines.reduce((sum, l) => sum + (l.value || 0), 0));
      doc.totalLoss = round2(doc.lines.reduce((sum, l) => sum + (l.lossValue || 0), 0));
    } else {
      doc.lines.forEach((l) => { delete l.unitCost; });
    }
    return successResponse(res, doc);
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- draft

// POST /api/stock-transfer — buat draft. Gudang asal harus dalam akses user (pengirim).
exports.createTransfer = async (req, res) => {
  try {
    const parsed = parseTransfer(req.body);
    assertGudang(req, parsed.fromGudang);
    const doc = await runInTransaction(async () => {
      await resolveRefs(parsed);
      const doc = await StockTransfer.create({
        ...parsed,
        no: await nextDocNo('TRF'),
        status: 'DRAFT',
        createdBy: req.user._id,
      });
      await audit.logCreate(req, 'stockTransfer', [doc]);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} saved as draft`, 201);
  } catch (error) {
    return handleError(res, error);
  }
};

const loadDraft = async (req, id) => {
  const doc = await loadDoc(id);
  assertGudang(req, doc.fromGudang);
  if (doc.status !== 'DRAFT') throw new HttpError(`Transfer is already ${doc.status.toLowerCase().replace('_', ' ')} and can no longer be changed`, 400);
  return doc;
};

// PUT /api/stock-transfer/:id — ubah draft
exports.updateTransfer = async (req, res) => {
  try {
    const doc = await runInTransaction(async () => {
      const doc = await loadDraft(req, req.params.id);
      const parsed = parseTransfer(req.body);
      assertGudang(req, parsed.fromGudang);
      await resolveRefs(parsed);
      const before = await audit.snap('stockTransfer', [doc]);
      Object.assign(doc, parsed, { updatedDate: new Date(), updatedBy: req.user._id });
      await doc.save();
      await audit.logUpdate(req, 'stockTransfer', before, [doc]);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} successfully updated`);
  } catch (error) {
    return handleError(res, error);
  }
};

// DELETE /api/stock-transfer/:id — hanya draft
exports.deleteTransfer = async (req, res) => {
  try {
    const doc = await runInTransaction(async () => {
      const doc = await loadDoc(req.params.id);
      assertGudang(req, doc.fromGudang);
      if (doc.status !== 'DRAFT') throw new HttpError('Only draft transfers can be deleted. Cancel a sent transfer instead.', 400);
      const before = await audit.snap('stockTransfer', [doc]);
      await doc.deleteOne();
      await audit.logDelete(req, 'stockTransfer', before);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} successfully deleted`);
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- kirim / terima / batal (izin 'post')

/**
 * POST /api/stock-transfer/:id/send — stok keluar dari gudang asal (TRANSFER_OUT).
 * HPP saat itu disimpan per baris -> dipakai saat diterima / dibatalkan.
 */
exports.sendTransfer = async (req, res) => {
  try {
    const doc = await runInTransaction(async () => {
      const doc = await loadDraft(req, req.params.id);
      if (!doc.lines.length) throw new HttpError('Transfer has no lines', 400);
      // validasi ulang referensi (gudang bisa dinonaktifkan sejak draft disimpan)
      const parsed = {
        fromGudang: String(doc.fromGudang),
        toGudang: String(doc.toGudang),
        lines: doc.lines.map((l) => ({ sku: String(l.sku) })),
      };
      await resolveRefs(parsed);

      const before = await audit.snap('stockTransfer', [doc]);
      const movements = await applyMovements(req, doc.lines.map((l) => ({
        sku: l.sku,
        gudang: doc.fromGudang,
        qty: -l.qty,
        type: 'TRANSFER_OUT',
        note: l.note || doc.note,
      })), { refType: 'StockTransfer', refId: doc._id, refNo: doc.no });

      const costOf = new Map(movements.map((m) => [String(m.sku), m.unitCost ?? null]));
      doc.lines.forEach((l) => { l.unitCost = costOf.get(String(l.sku)) ?? null; });
      doc.status = 'IN_TRANSIT';
      doc.sentBy = req.user._id;
      doc.sentDate = new Date();
      await doc.save();
      await audit.logUpdate(req, 'stockTransfer', before, [doc]);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} sent`);
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * POST /api/stock-transfer/:id/receive  body: { lines?: [{ sku, qtyReceived }], note? }
 * Stok masuk ke gudang tujuan (TRANSFER_IN) dengan HPP saat dikirim. Baris tanpa qtyReceived =
 * diterima penuh. Kurang dari dikirim boleh (selisih = hilang/rusak di perjalanan, note wajib);
 * lebih dari dikirim ditolak. Gudang tujuan harus dalam akses user.
 */
exports.receiveTransfer = async (req, res) => {
  try {
    const input = new Map((Array.isArray(req.body.lines) ? req.body.lines : []).map((l) => [String(l?.sku), l?.qtyReceived]));
    const receiveNote = trimText(req.body.note);

    const doc = await runInTransaction(async () => {
      const doc = await loadDoc(req.params.id);
      assertGudang(req, doc.toGudang);
      if (doc.status !== 'IN_TRANSIT') throw new HttpError('Only transfers in transit can be received', 400);
      await lock(ref('gudang', doc.toGudang));
      if (!(await Gudang.exists({ _id: doc.toGudang }))) throw new HttpError('Destination warehouse no longer exists', 400);

      const skus = await ProdukSku.find({ _id: { $in: doc.lines.map((l) => l.sku) } }).select('sku').lean();
      const codeOf = new Map(skus.map((s) => [String(s._id), s.sku]));
      let short = false;
      const received = doc.lines.map((l) => {
        const raw = input.has(String(l.sku)) ? input.get(String(l.sku)) : l.qty;
        const code = codeOf.get(String(l.sku)) || 'Item';
        const err = checkAmount(raw, 'Received quantity', { min: 0 });
        if (err) throw new HttpError(`${code}: ${err}`, 400);
        const qty = round2(raw);
        if (qty > l.qty) throw new HttpError(`${code}: received ${fmt(qty)} exceeds the sent quantity ${fmt(l.qty)}`, 400);
        if (qty < l.qty) short = true;
        return qty;
      });
      if (short && !receiveNote) {
        throw new HttpError('Some items were received short. Explain the difference (lost / damaged in transit) in the note.', 400);
      }

      const before = await audit.snap('stockTransfer', [doc]);
      await applyMovements(req, doc.lines.map((l, i) => ({
        sku: l.sku,
        gudang: doc.toGudang,
        qty: received[i],
        unitCost: l.unitCost,   // nilai berpindah dengan HPP saat dikirim
        type: 'TRANSFER_IN',
        note: l.note || doc.note,
      })), { refType: 'StockTransfer', refId: doc._id, refNo: doc.no });

      doc.lines.forEach((l, i) => { l.qtyReceived = received[i]; });
      doc.status = 'RECEIVED';
      doc.receivedBy = req.user._id;
      doc.receivedDate = new Date();
      doc.receiveNote = receiveNote || null;
      await doc.save();
      await audit.logUpdate(req, 'stockTransfer', before, [doc]);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} received`);
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * POST /api/stock-transfer/:id/cancel  body: { reason } — hanya IN_TRANSIT (belum diterima):
 * movement pembalik, stok & nilainya kembali ke gudang asal. Setelah diterima: buat transfer balik.
 */
exports.cancelTransfer = async (req, res) => {
  try {
    const cancelReason = trimText(req.body.reason);
    if (!cancelReason) return errorResponse(res, 'Cancellation reason is required', 400);

    const doc = await runInTransaction(async () => {
      const doc = await loadDoc(req.params.id);
      assertGudang(req, doc.fromGudang);
      if (doc.status !== 'IN_TRANSIT') {
        throw new HttpError(doc.status === 'RECEIVED'
          ? 'Transfer has already been received. Create a transfer back instead.'
          : doc.status === 'DRAFT' ? 'Draft transfers are deleted, not cancelled' : 'Transfer is already cancelled', 400);
      }
      await lock(ref('gudang', doc.fromGudang));

      const before = await audit.snap('stockTransfer', [doc]);
      await applyMovements(req, doc.lines.map((l) => ({
        sku: l.sku,
        gudang: doc.fromGudang,
        qty: l.qty,
        unitCost: l.unitCost,
        type: 'TRANSFER_OUT',
        note: `Cancelled: ${cancelReason}`,
      })), { refType: 'StockTransfer', refId: doc._id, refNo: doc.no, isReversal: true });

      doc.status = 'CANCELLED';
      doc.cancelledBy = req.user._id;
      doc.cancelledDate = new Date();
      doc.cancelReason = cancelReason;
      await doc.save();
      await audit.logUpdate(req, 'stockTransfer', before, [doc]);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} cancelled`);
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- in transit (laporan)

/**
 * Barang dalam perjalanan (transfer IN_TRANSIT), opsional dibatasi gudang.
 * `gudangIds` = null (semua) | [id] -> transfer yang asal ATAU tujuannya termasuk.
 * -> { qtyBySkuTo: Map "sku:toGudang" -> qty, value, docCount }
 */
exports.inTransitSummary = async (gudangIds = null) => {
  const match = { status: 'IN_TRANSIT' };
  if (gudangIds) {
    const ids = gudangIds.map((id) => new mongoose.Types.ObjectId(String(id)));
    match.$or = [{ fromGudang: { $in: ids } }, { toGudang: { $in: ids } }];
  }
  const docs = await StockTransfer.find(match).select('toGudang lines.sku lines.qty lines.unitCost').lean();
  const qtyBySkuTo = new Map();
  let value = 0;
  for (const d of docs) {
    for (const l of d.lines) {
      const key = `${l.sku}:${d.toGudang}`;
      qtyBySkuTo.set(key, round2((qtyBySkuTo.get(key) || 0) + l.qty));
      value += l.qty * (l.unitCost || 0);
    }
  }
  return { qtyBySkuTo, value: round2(value), docCount: docs.length };
};
