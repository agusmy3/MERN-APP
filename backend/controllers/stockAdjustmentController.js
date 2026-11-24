const mongoose = require('mongoose');
const StockAdjustment = require('../models/StockAdjustment');
const ProdukSku = require('../models/ProdukSku');
const Produk = require('../models/Produk');
const Gudang = require('../models/Gudang');
const StockMovement = require('../models/StockMovement');
const { hasPermission } = require('../config/permissions');
const {
  successResponse,
  errorResponse
} = require('../helpers/responseHelper');
const audit = require('../helpers/auditLogger');
const { runInTransaction, HttpError, lock, ref } = require('../helpers/transaction');
const { applyMovements, getBalances, nextDocNo } = require('../helpers/stockHelper');
const { checkAmount, round2 } = require('../helpers/number');
const { assertGudang, applyGudangFilter } = require('../helpers/gudangAccess');
const { ADJUSTMENT_TYPES, REASONS, STATUSES, MAX_LINES } = require('../config/stock');

const SORTABLE_FIELDS = ['no', 'date', 'createdDate', 'updatedDate', 'postedDate'];

const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status);
  if (error.name === 'ValidationError' || error.name === 'CastError') {
    return errorResponse(res, error.message, 400);
  }
  return errorResponse(res, error.message, 500);
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const trimText = (v, max = 500) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));

/**
 * Validasi & normalisasi isi dokumen (header + baris) dari body. Murni (tanpa database).
 * `type` = jenis dokumen (tidak bisa diubah setelah dibuat).
 */
const parseDocument = (body, type) => {
  if (!ADJUSTMENT_TYPES[type]) throw new HttpError('Please select a valid document type', 400);
  if (!mongoose.isValidObjectId(body.gudang)) throw new HttpError('Please select a warehouse', 400);

  const date = body.date ? new Date(body.date) : new Date();
  if (Number.isNaN(date.getTime())) throw new HttpError('Invalid document date', 400);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  if (date > endOfToday) throw new HttpError('Document date cannot be in the future', 400);

  // Stock Opname selalu beralasan OPNAME; Adjustment memilih alasan lain
  const reason = type === 'OPNAME' ? 'OPNAME' : String(body.reason || '');
  if (!REASONS[reason] || (type === 'ADJUSTMENT' && reason === 'OPNAME')) {
    throw new HttpError('Please select a valid reason', 400);
  }
  const note = trimText(body.note);
  if (reason === 'OTHER' && !note) throw new HttpError('Note is required for reason "Other"', 400);

  const input = Array.isArray(body.lines) ? body.lines : [];
  if (!input.length) throw new HttpError('Add at least one SKU line', 400);
  if (input.length > MAX_LINES) throw new HttpError(`A document can have at most ${MAX_LINES} lines`, 400);

  const seen = new Set();
  const lines = input.map((l, i) => {
    const n = i + 1;
    if (!mongoose.isValidObjectId(l?.sku)) throw new HttpError(`Line ${n}: invalid SKU`, 400);
    if (seen.has(String(l.sku))) throw new HttpError(`Line ${n}: the same SKU appears more than once`, 400);
    seen.add(String(l.sku));

    const line = { sku: String(l.sku), note: trimText(l.note, 200) || undefined };
    if (type === 'OPNAME') {
      const err = checkAmount(l.qtyActual, 'Counted quantity', { min: 0 });
      if (err) throw new HttpError(`Line ${n}: ${err}`, 400);
      line.qtyActual = round2(l.qtyActual);
      line.qtyChange = null;
    } else {
      const err = checkAmount(l.qtyChange, 'Quantity change', { min: null, nonZero: true });
      if (err) throw new HttpError(`Line ${n}: ${err}`, 400);
      line.qtyChange = round2(l.qtyChange);
      line.qtyActual = null;
    }
    line.qtySystem = null;
    line.unitCost = null;
    const costGiven = l.unitCost !== undefined && l.unitCost !== null && l.unitCost !== '';
    if (reason === 'OPENING' && line.qtyChange > 0 && costGiven) {
      const err = checkAmount(l.unitCost, 'Unit cost');
      if (err) throw new HttpError(`Line ${n}: ${err}`, 400);
      line.unitCost = round2(l.unitCost);
    }
    return line;
  });

  return { gudang: String(body.gudang), date, reason, note, lines };
};

/**
 * Cek referensi di dalam transaksi + kunci: gudang (bentrok dengan hapus gudang) dan produk tiap SKU
 * (bentrok dengan hapus SKU/produk yang mengecek apakah SKU dipakai dokumen stok).
 * Mengisi line.produk.
 */
const resolveRefs = async (parsed) => {
  const skus = await ProdukSku.find({ _id: { $in: parsed.lines.map((l) => l.sku) } }).select('produk').lean();
  await lock(ref('gudang', parsed.gudang), [...new Set(skus.map((s) => String(s.produk)))].map((id) => ref('produk', id)));

  const gudang = await Gudang.findById(parsed.gudang).select('isActive').lean();
  if (!gudang) throw new HttpError('Please select a valid warehouse', 400);
  if (gudang.isActive === false) throw new HttpError('Warehouse is inactive', 400);

  const fresh = await ProdukSku.find({ _id: { $in: parsed.lines.map((l) => l.sku) } }).select('produk').lean();
  if (fresh.length !== parsed.lines.length) throw new HttpError('One or more SKUs no longer exist', 400);
  const produkOf = new Map(fresh.map((s) => [String(s._id), s.produk]));
  parsed.lines.forEach((l) => { l.produk = produkOf.get(l.sku); });
};

const loadDraft = async (id) => {
  const doc = await StockAdjustment.findById(id);
  if (!doc) throw new HttpError('Stock adjustment not found', 404);
  if (doc.status !== 'DRAFT') throw new HttpError(`Document is already ${doc.status.toLowerCase()} and can no longer be changed`, 400);
  return doc;
};

const movementType = (doc) => (doc.reason === 'OPENING' ? 'OPENING' : doc.type);

const populateDoc = (query) => query
  .populate('gudang', 'code name isActive')
  .populate({
    path: 'lines.sku',
    select: 'sku variantValues isActive',
  })
  .populate({ path: 'lines.produk', select: 'name uom', populate: { path: 'uom', select: 'code' } })
  .populate('createdBy', 'name')
  .populate('updatedBy', 'name')
  .populate('postedBy', 'name')
  .populate('cancelledBy', 'name');

// ---------------------------------------------------------------- baca

// GET /api/stock-adjustment — daftar dokumen (tanpa baris), filter status/type/gudang/tanggal
exports.getStockAdjustments = async (req, res) => {
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
    if (ADJUSTMENT_TYPES[req.query.type]) filter.type = req.query.type;
    if (req.query.reason && REASONS[req.query.reason]) filter.reason = req.query.reason;
    applyGudangFilter(req, filter, req.query.gudang); // hanya gudang yang boleh diakses user
    if (req.query.from || req.query.to) {
      filter.date = {};
      if (req.query.from) filter.date.$gte = new Date(`${req.query.from}T00:00:00`);
      if (req.query.to) filter.date.$lte = new Date(`${req.query.to}T23:59:59.999`);
      if (Object.values(filter.date).some((d) => Number.isNaN(d.getTime()))) return errorResponse(res, 'Invalid date', 400);
    }

    const [totalData, docs] = await Promise.all([
      StockAdjustment.countDocuments(filter),
      StockAdjustment.find(filter)
        .select('-lines')
        .populate('gudang', 'code name')
        .populate('createdBy', 'name')
        .populate('updatedBy', 'name')
        .populate('postedBy', 'name')
        .sort({ [sortField]: sortOrder, _id: sortOrder })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);

    // jumlah baris per dokumen tanpa mengirim isi barisnya
    const counts = await StockAdjustment.aggregate([
      { $match: { _id: { $in: docs.map((d) => d._id) } } },
      { $project: { lineCount: { $size: '$lines' } } },
    ]);
    const countMap = new Map(counts.map((c) => [String(c._id), c.lineCount]));
    docs.forEach((d) => { d.lineCount = countMap.get(String(d._id)) || 0; });

    // nilai rupiah dokumen yang sudah diposting = jumlah value movement-nya (data biaya: vendorPrice:view)
    const canSeeCost = hasPermission(req.user, 'vendorPrice', 'view');
    if (canSeeCost) {
      const values = await StockMovement.aggregate([
        { $match: { refType: 'StockAdjustment', refId: { $in: docs.map((d) => d._id) }, isReversal: false } },
        { $group: { _id: '$refId', value: { $sum: '$value' } } },
      ]);
      const valueMap = new Map(values.map((v) => [String(v._id), round2(v.value || 0)]));
      docs.forEach((d) => { d.totalValue = d.status === 'DRAFT' ? null : (valueMap.get(String(d._id)) ?? 0); });
    }

    return successResponse(res, {
      dataStockAdjustment: docs,
      canSeeCost,
      totalData,
      currentPage: page,
      totalPages: Math.ceil(totalData / pageSize),
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// GET /api/stock-adjustment/:id — dokumen lengkap. Draft: + currentQty (saldo saat ini) per baris
exports.getStockAdjustment = async (req, res) => {
  try {
    const doc = await populateDoc(StockAdjustment.findById(req.params.id)).lean();
    if (!doc) return errorResponse(res, 'Stock adjustment not found', 404);
    assertGudang(req, doc.gudang?._id);

    if (doc.status === 'DRAFT' && doc.gudang) {
      const balances = await getBalances(doc.gudang._id, doc.lines.map((l) => l.sku?._id).filter(Boolean));
      doc.lines.forEach((l) => { l.currentQty = l.sku ? (balances.get(String(l.sku._id)) || 0) : null; });
    }

    // nilai rupiah per baris (data biaya: vendorPrice:view)
    //   draft  : perkiraan = perubahan x HPP saat ini
    //   posted : dari movement saat post (HPP saat itu)
    doc.canSeeCost = hasPermission(req.user, 'vendorPrice', 'view');
    if (doc.canSeeCost) {
      if (doc.status === 'DRAFT') {
        const skus = await ProdukSku.find({ _id: { $in: doc.lines.map((l) => l.sku?._id).filter(Boolean) } }).select('avgCost').lean();
        const avg = new Map(skus.map((s) => [String(s._id), s.avgCost ?? null]));
        doc.lines.forEach((l) => {
          const avgCost = l.sku ? avg.get(String(l.sku._id)) ?? null : null;
          const change = doc.type === 'OPNAME'
            ? (l.qtyActual === null || l.currentQty === null ? null : round2(l.qtyActual - l.currentQty))
            : l.qtyChange;
          l.inputCost = l.unitCost ?? null;      // harga pokok yang diisi (Saldo Awal)
          l.avgCost = avgCost;                   // HPP SKU saat ini
          const cost = l.inputCost ?? avgCost;
          l.unitCost = cost;
          l.value = cost === null || change === null ? null : round2(change * cost);
        });
      } else {
        const movements = await StockMovement.find({ refType: 'StockAdjustment', refId: doc._id, isReversal: false })
          .select('sku unitCost value').lean();
        const bySku = new Map(movements.map((m) => [String(m.sku), m]));
        doc.lines.forEach((l) => {
          const m = l.sku ? bySku.get(String(l.sku._id)) : null;
          l.unitCost = m?.unitCost ?? null;
          l.value = m ? m.value ?? null : (l.qtyChange === 0 ? 0 : null);
        });
      }
      doc.totalValue = round2(doc.lines.reduce((sum, l) => sum + (l.value || 0), 0));
    } else {
      doc.lines.forEach((l) => { delete l.unitCost; }); // harga pokok = data biaya
    }
    return successResponse(res, doc);
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * GET /api/stock-adjustment/skus?gudang=&search=|produk=|kategori=
 * Pencarian SKU lintas produk untuk baris dokumen + saldo di gudang tsb.
 * - search             : kode SKU / nama produk, maks. 20 hasil
 * - produk / kategori  : SEMUA SKU produk/kategori tsb (untuk stock opname)
 */
exports.searchSkus = async (req, res) => {
  try {
    const { gudang, search, produk, kategori } = req.query;
    if (gudang && mongoose.isValidObjectId(gudang)) assertGudang(req, gudang);
    const filter = {};
    let limit = 20;

    if (produk || kategori) {
      if (produk && !mongoose.isValidObjectId(produk)) return errorResponse(res, 'Invalid product', 400);
      if (kategori && !mongoose.isValidObjectId(kategori)) return errorResponse(res, 'Invalid category', 400);
      filter.produk = produk
        ? produk
        : { $in: await Produk.find({ kategori }).distinct('_id') };
      limit = MAX_LINES;
    } else if (search && String(search).trim()) {
      const rx = { $regex: escapeRegex(String(search).trim()), $options: 'i' };
      const produkIds = await Produk.find({ name: rx }).distinct('_id');
      filter.$or = [{ sku: rx }, { produk: { $in: produkIds } }];
    } else {
      return successResponse(res, []);
    }
    if (req.query.activeOnly === 'true') filter.isActive = true;

    const skus = await ProdukSku.find(filter)
      .select('sku produk variantValues isActive avgCost')
      .populate({ path: 'produk', select: 'name uom', populate: { path: 'uom', select: 'code' } })
      .sort({ sku: 1 })
      .limit(limit)
      .lean();

    const canSeeCost = hasPermission(req.user, 'vendorPrice', 'view');
    const balances = gudang && mongoose.isValidObjectId(gudang)
      ? await getBalances(gudang, skus.map((s) => s._id))
      : new Map();

    return successResponse(res, skus.map((s) => ({
      _id: s._id,
      sku: s.sku,
      isActive: s.isActive !== false,
      variant: (s.variantValues || []).map((v) => v.value).join(' / ') || 'Default',
      produk: s.produk ? { _id: s.produk._id, name: s.produk.name } : null,
      uom: s.produk?.uom?.code || '',
      qty: balances.get(String(s._id)) || 0,
      // HPP hanya untuk yang boleh melihat data biaya (perkiraan nilai penyesuaian di form)
      ...(canSeeCost ? { avgCost: s.avgCost ?? null } : {}),
    })));
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * POST /api/stock-adjustment/skus/balance  body: { gudang, skus: [skuId, ...] }
 * Saldo sekumpulan SKU di 1 gudang (form dokumen saat gudang diganti). Baca saja; POST karena
 * daftar id bisa panjang. -> { <skuId>: qty }
 */
exports.skuBalances = async (req, res) => {
  try {
    const { gudang } = req.body;
    const ids = (Array.isArray(req.body.skus) ? req.body.skus : []).filter((id) => mongoose.isValidObjectId(id));
    if (!mongoose.isValidObjectId(gudang)) return errorResponse(res, 'Invalid warehouse', 400);
    assertGudang(req, gudang);
    if (ids.length > MAX_LINES) return errorResponse(res, `At most ${MAX_LINES} SKUs`, 400);
    const balances = await getBalances(gudang, ids);
    return successResponse(res, Object.fromEntries(ids.map((id) => [id, balances.get(String(id)) || 0])));
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- draft

// POST /api/stock-adjustment — buat draft (stok belum berubah)
exports.createStockAdjustment = async (req, res) => {
  try {
    const type = String(req.body.type || '');
    const parsed = parseDocument(req.body, type);
    assertGudang(req, parsed.gudang);
    if (!hasPermission(req.user, 'vendorPrice', 'view')) parsed.lines.forEach((l) => { l.unitCost = null; });

    const doc = await runInTransaction(async () => {
      await resolveRefs(parsed);
      const doc = await StockAdjustment.create({
        ...parsed,
        no: await nextDocNo(ADJUSTMENT_TYPES[type].prefix),
        type,
        status: 'DRAFT',
        createdBy: req.user._id,
      });
      await audit.logCreate(req, 'stockAdjustment', [doc]);
      return doc;
    });

    return successResponse(res, doc, `${doc.no} saved as draft`, 201);
  } catch (error) {
    return handleError(res, error);
  }
};

// PUT /api/stock-adjustment/:id — ubah draft (jenis dokumen tidak bisa diubah)
exports.updateStockAdjustment = async (req, res) => {
  try {
    const doc = await runInTransaction(async () => {
      const doc = await loadDraft(req.params.id);
      const parsed = parseDocument(req.body, doc.type);
      assertGudang(req, doc.gudang, parsed.gudang);
      if (!hasPermission(req.user, 'vendorPrice', 'view')) {
        const kept = new Map(doc.lines.map((l) => [String(l.sku), l.unitCost ?? null]));
        parsed.lines.forEach((l) => { l.unitCost = parsed.reason === 'OPENING' && l.qtyChange > 0 ? kept.get(l.sku) ?? null : null; });
      }
      await resolveRefs(parsed);

      const before = await audit.snap('stockAdjustment', [doc]);
      doc.gudang = parsed.gudang;
      doc.date = parsed.date;
      doc.reason = parsed.reason;
      doc.note = parsed.note;
      doc.lines = parsed.lines;
      doc.updatedDate = new Date();
      doc.updatedBy = req.user._id;
      await doc.save();
      await audit.logUpdate(req, 'stockAdjustment', before, [doc]);
      return doc;
    });

    const out = doc.toObject();
    if (!hasPermission(req.user, 'vendorPrice', 'view')) out.lines.forEach((l) => { delete l.unitCost; });
    return successResponse(res, out, `${doc.no} successfully updated`);
  } catch (error) {
    return handleError(res, error);
  }
};

// DELETE /api/stock-adjustment/:id — hanya draft (dokumen yang sudah diposting dibatalkan, bukan dihapus)
exports.deleteStockAdjustment = async (req, res) => {
  try {
    const doc = await runInTransaction(async () => {
      const doc = await StockAdjustment.findById(req.params.id);
      if (!doc) throw new HttpError('Stock adjustment not found', 404);
      assertGudang(req, doc.gudang);
      if (doc.status !== 'DRAFT') {
        throw new HttpError('Only draft documents can be deleted. Cancel a posted document instead.', 400);
      }
      const before = await audit.snap('stockAdjustment', [doc]);
      await doc.deleteOne();
      await audit.logDelete(req, 'stockAdjustment', before);
      return doc;
    });

    return successResponse(res, doc, `${doc.no} successfully deleted`);
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- post & cancel (izin 'post')

/**
 * POST /api/stock-adjustment/:id/post — terapkan ke stok (1 transaksi):
 * saldo sistem dicatat per baris, selisih dihitung (opname), stok & kartu stok diperbarui.
 * Satu baris membuat stok minus -> seluruh dokumen ditolak.
 */
exports.postStockAdjustment = async (req, res) => {
  try {
    const doc = await runInTransaction(async () => {
      const doc = await StockAdjustment.findById(req.params.id);
      if (!doc) throw new HttpError('Stock adjustment not found', 404);
      assertGudang(req, doc.gudang);
      if (doc.status !== 'DRAFT') throw new HttpError(`Document is already ${doc.status.toLowerCase()}`, 400);
      if (!doc.lines.length) throw new HttpError('Document has no lines', 400);

      await lock(ref('gudang', doc.gudang)); // gudang tidak boleh terhapus bersamaan
      if (!(await Gudang.exists({ _id: doc.gudang }))) throw new HttpError('Warehouse no longer exists', 400);

      const before = await audit.snap('stockAdjustment', [doc]);
      const balances = await getBalances(doc.gudang, doc.lines.map((l) => l.sku));
      doc.lines.forEach((l) => {
        l.qtySystem = balances.get(String(l.sku)) || 0;
        if (doc.type === 'OPNAME') l.qtyChange = round2(l.qtyActual - l.qtySystem);
      });

      if (doc.reason === 'OPENING') {
        const skus = await ProdukSku.find({ _id: { $in: doc.lines.map((l) => l.sku) } }).select('sku avgCost').lean();
        const missing = skus.filter((s) => (s.avgCost === null || s.avgCost === undefined)
          && doc.lines.some((l) => String(l.sku) === String(s._id) && l.qtyChange > 0 && (l.unitCost === null || l.unitCost === undefined)));
        if (missing.length) {
          throw new HttpError(`Fill in the unit cost for SKU without HPP: ${missing.map((s) => s.sku).join(', ')}`, 400);
        }
      }

      await applyMovements(req, doc.lines.map((l) => ({
        sku: l.sku,
        gudang: doc.gudang,
        qty: l.qtyChange,
        // harga pokok Saldo Awal -> HPP rata-rata dihitung ulang (seperti pembelian)
        unitCost: doc.reason === 'OPENING' && l.qtyChange > 0 ? l.unitCost : null,
        type: movementType(doc),
        reason: doc.reason,
        note: l.note || doc.note,
      })), { refType: 'StockAdjustment', refId: doc._id, refNo: doc.no });

      doc.status = 'POSTED';
      doc.postedBy = req.user._id;
      doc.postedDate = new Date();
      await doc.save();
      await audit.logUpdate(req, 'stockAdjustment', before, [doc]);
      return doc;
    });

    return successResponse(res, doc, `${doc.no} successfully posted`);
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * POST /api/stock-adjustment/:id/cancel  body: { reason }
 * Membatalkan dokumen yang sudah diposting: movement pembalik dibuat (tidak ada yang dihapus).
 * Ditolak jika stok sekarang tidak cukup untuk dibalik.
 */
exports.cancelStockAdjustment = async (req, res) => {
  try {
    const cancelReason = trimText(req.body.reason);
    if (!cancelReason) return errorResponse(res, 'Cancellation reason is required', 400);

    const doc = await runInTransaction(async () => {
      const doc = await StockAdjustment.findById(req.params.id);
      if (!doc) throw new HttpError('Stock adjustment not found', 404);
      assertGudang(req, doc.gudang);
      if (doc.status !== 'POSTED') throw new HttpError('Only posted documents can be cancelled', 400);

      const before = await audit.snap('stockAdjustment', [doc]);
      await applyMovements(req, doc.lines.map((l) => ({
        sku: l.sku,
        gudang: doc.gudang,
        qty: -(l.qtyChange || 0),
        unitCost: doc.reason === 'OPENING' && l.qtyChange > 0 ? l.unitCost : null,
        type: movementType(doc),
        reason: doc.reason,
        note: `Cancelled: ${cancelReason}`,
      })), { refType: 'StockAdjustment', refId: doc._id, refNo: doc.no, isReversal: true });

      doc.status = 'CANCELLED';
      doc.cancelledBy = req.user._id;
      doc.cancelledDate = new Date();
      doc.cancelReason = cancelReason;
      await doc.save();
      await audit.logUpdate(req, 'stockAdjustment', before, [doc]);
      return doc;
    });

    return successResponse(res, doc, `${doc.no} successfully cancelled`);
  } catch (error) {
    return handleError(res, error);
  }
};
