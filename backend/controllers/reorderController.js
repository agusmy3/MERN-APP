const mongoose = require('mongoose');
const ReorderRule = require('../models/ReorderRule');
const ProdukSku = require('../models/ProdukSku');
const Produk = require('../models/Produk');
const Gudang = require('../models/Gudang');
const StockBalance = require('../models/StockBalance');
const PurchaseOrder = require('../models/PurchaseOrder');
const VendorPrice = require('../models/VendorPrice');
const { successResponse, errorResponse } = require('../helpers/responseHelper');
const audit = require('../helpers/auditLogger');
const { runInTransaction, HttpError, lock, ref } = require('../helpers/transaction');
const { checkAmount, round2 } = require('../helpers/number');
const { hasPermission } = require('../config/permissions');
const { createDraftPoInTransaction } = require('./purchaseOrderController');
const { assertGudang, applyGudangFilter } = require('../helpers/gudangAccess');
const { inTransitSummary } = require('./stockTransferController');

const ALERT_STATUSES = ['OUT', 'CRITICAL', 'ORDERED'];

const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status);
  if (error.name === 'ValidationError' || error.name === 'CastError') return errorResponse(res, error.message, 400);
  return errorResponse(res, error.message, 500);
};
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isBlank = (v) => v === undefined || v === null || v === '';

/**
 * Status 1 rule:
 *   OUT      : stok <= 0
 *   CRITICAL : stok <= min DAN stok + sedang dipesan <= min (belum tertutup PO)
 *   ORDERED  : stok <= min tapi PO terbuka sudah menutupinya
 *   OK       : stok > min
 */
const statusOf = (onHand, onOrder, min) => {
  if (onHand > min) return 'OK';
  if (onHand <= 0 && onHand + onOrder <= min) return 'OUT';
  if (onHand + onOrder <= min) return 'CRITICAL';
  return 'ORDERED';
};

/** Qty yang sedang dipesan (PO OPEN / PARTIAL, sisa x konversi) per SKU+gudang: Map "sku:gudang" -> qty */
const onOrderMap = async (filter = {}) => {
  const rows = await PurchaseOrder.aggregate([
    { $match: { status: { $in: ['OPEN', 'PARTIAL'] }, ...filter } },
    { $unwind: '$lines' },
    {
      $group: {
        _id: { sku: '$lines.sku', gudang: '$gudang' },
        qty: { $sum: { $multiply: [{ $max: [{ $subtract: ['$lines.qty', { $ifNull: ['$lines.qtyReceived', 0] }] }, 0] }, '$lines.konversi'] } },
      }
    },
  ]);
  return new Map(rows.map((r) => [`${r._id.sku}:${r._id.gudang}`, round2(r.qty)]));
};

/**
 * Hitung semua rule (opsional difilter) -> baris alert lengkap.
 * "Sedang dipesan" = sisa PO terbuka + transfer yang sedang dikirim KE gudang tsb.
 * Rule untuk SKU / gudang nonaktif diabaikan.
 */
const evaluateRules = async (ruleFilter = {}) => {
  const rules = await ReorderRule.find(ruleFilter).lean();
  if (!rules.length) return [];
  const skuIds = [...new Set(rules.map((r) => String(r.sku)))];
  const [skus, gudangs, balances, onOrder] = await Promise.all([
    ProdukSku.find({ _id: { $in: skuIds } }).select('sku produk variantValues isActive')
      .populate({ path: 'produk', select: 'name kategori uom', populate: [{ path: 'uom', select: 'code' }, { path: 'kategori', select: 'name' }] })
      .lean(),
    Gudang.find({ _id: { $in: [...new Set(rules.map((r) => String(r.gudang)))] } }).select('code name isActive').lean(),
    StockBalance.find({ sku: { $in: skuIds } }).select('sku gudang qty').lean(),
    onOrderMap({ 'lines.sku': { $in: skuIds.map((id) => new mongoose.Types.ObjectId(id)) } }),
  ]);
  const { qtyBySkuTo } = await inTransitSummary();
  for (const [key, qty] of qtyBySkuTo) onOrder.set(key, round2((onOrder.get(key) || 0) + qty));
  const skuMap = new Map(skus.map((s) => [String(s._id), s]));
  const gudangMap = new Map(gudangs.map((g) => [String(g._id), g]));
  const balMap = new Map(balances.map((b) => [`${b.sku}:${b.gudang}`, b.qty]));

  return rules.map((r) => {
    const sku = skuMap.get(String(r.sku));
    const gudang = gudangMap.get(String(r.gudang));
    if (!sku || !gudang || sku.isActive === false || gudang.isActive === false) return null;
    const key = `${r.sku}:${r.gudang}`;
    const onHand = balMap.get(key) || 0;
    const ordered = onOrder.get(key) || 0;
    const position = round2(onHand + ordered);
    const status = statusOf(onHand, ordered, r.minQty);
    return {
      _id: r._id,
      sku: { _id: sku._id, sku: sku.sku, variantValues: sku.variantValues },
      produk: { _id: sku.produk?._id, name: sku.produk?.name, kategori: sku.produk?.kategori || null },
      uom: sku.produk?.uom?.code || '',
      uomId: sku.produk?.uom?._id || null,   // satuan dasar (untuk PO tanpa harga vendor)
      gudang,
      minQty: r.minQty,
      maxQty: r.maxQty,
      onHand,
      onOrder: ordered,
      position,
      status,
      // saran dalam satuan dasar (hanya bila belum tertutup PO)
      suggestedQty: ['OUT', 'CRITICAL'].includes(status) ? Math.max(round2(r.maxQty - position), 0) : 0,
    };
  }).filter(Boolean);
};

const STATUS_ORDER = { OUT: 0, CRITICAL: 1, ORDERED: 2, OK: 3 };

// ---------------------------------------------------------------- alert

/**
 * GET /api/reorder?status=OUT|CRITICAL|ORDERED|ALL&gudang=&kategori=&vendor=&search=
 * Default: semua status alert (OUT, CRITICAL, ORDERED). Setiap baris + vendor utama & saran qty
 * dalam satuan belinya (dibulatkan ke atas, min. order). Harga hanya untuk vendorPrice:view.
 */
exports.getAlerts = async (req, res) => {
  try {
    const ruleFilter = applyGudangFilter(req, {}, req.query.gudang); // hanya gudang yang boleh diakses
    if (req.query.kategori || req.query.search) {
      const produkFilter = {};
      if (req.query.kategori) {
        if (!mongoose.isValidObjectId(req.query.kategori)) return errorResponse(res, 'Invalid category', 400);
        produkFilter.kategori = req.query.kategori;
      }
      if (req.query.search) {
        const rx = { $regex: escapeRegex(req.query.search), $options: 'i' };
        const viaSku = await ProdukSku.find({ sku: rx }).distinct('produk');
        produkFilter.$or = [{ name: rx }, { _id: { $in: viaSku } }];
      }
      ruleFilter.produk = { $in: await Produk.find(produkFilter).distinct('_id') };
    }

    let rows = await evaluateRules(ruleFilter);
    const wanted = req.query.status === 'ALL' ? null
      : ALERT_STATUSES.includes(req.query.status) ? [req.query.status] : ALERT_STATUSES;
    if (wanted) rows = rows.filter((r) => wanted.includes(r.status));

    // vendor utama (atau satu-satunya harga) per SKU -> saran dalam satuan beli
    const canSeeCost = hasPermission(req.user, 'vendorPrice', 'view');
    const showPrice = canSeeCost || hasPermission(req.user, 'purchaseOrder', 'create');
    const prices = await VendorPrice.find({ sku: { $in: rows.map((r) => r.sku._id) } })
      .populate('vendor', 'companyName').populate('uomBeli', 'code').lean();
    const bySku = new Map();
    prices.forEach((p) => bySku.set(String(p.sku), [...(bySku.get(String(p.sku)) || []), p]));
    rows.forEach((r) => {
      const list = bySku.get(String(r.sku._id)) || [];
      const price = list.find((p) => p.isPreferred) || (list.length === 1 ? list[0] : null);
      r.vendorPriceCount = list.length;
      // pilihan satuan beli per vendor (rencana pesan hanya boleh memakai ini atau satuan dasar)
      r.priceOptions = list.map((p) => ({
        vendor: p.vendor?._id || p.vendor,
        uomBeli: p.uomBeli,
        konversi: p.konversi,
        minOrder: p.minOrder || null,
        isPreferred: !!p.isPreferred,
        ...(showPrice ? { hargaBeli: p.hargaBeli } : {}),
      }));
      if (price) {
        let qty = r.suggestedQty > 0 ? Math.ceil(r.suggestedQty / price.konversi) : 0;
        if (qty > 0 && price.minOrder && qty < price.minOrder) qty = price.minOrder;
        r.suggestion = {
          vendor: price.vendor,
          uomBeli: price.uomBeli,
          konversi: price.konversi,
          qty,
          isPreferred: !!price.isPreferred,
          ...(showPrice
            ? { hargaBeli: price.hargaBeli, value: round2(qty * price.hargaBeli) }
            : {}),
        };
      } else {
        r.suggestion = null;
      }
    });
    if (req.query.vendor) rows = rows.filter((r) => String(r.suggestion?.vendor?._id) === String(req.query.vendor));

    rows.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
      || (a.position - a.minQty) - (b.position - b.minQty)
      || a.sku.sku.localeCompare(b.sku.sku));
    return successResponse(res, rows);
  } catch (error) {
    return handleError(res, error);
  }
};

/** GET /api/reorder/summary -> { OUT, CRITICAL, ORDERED, total } (badge navbar & dashboard) */
exports.getSummary = async (req, res) => {
  try {
    const rows = await evaluateRules(applyGudangFilter(req, {}));
    const counts = { OUT: 0, CRITICAL: 0, ORDERED: 0 };
    rows.forEach((r) => { if (counts[r.status] !== undefined) counts[r.status] += 1; });
    return successResponse(res, { ...counts, needAction: counts.OUT + counts.CRITICAL, monitored: rows.length });
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- rule (min / max)

/** GET /api/reorder/rules?produk= -> [{ sku, gudang, minQty, maxQty }] */
exports.getRules = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.query.produk)) return errorResponse(res, 'Invalid product', 400);
    const rules = await ReorderRule.find({ produk: req.query.produk }).select('sku gudang minQty maxQty').lean();
    return successResponse(res, rules);
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * PUT /api/reorder/rules  body: { rules: [{ sku, gudang, minQty, maxQty }] }  (izin reorder:update)
 * Upsert per SKU+gudang; min & max kosong = hapus rule. max >= min. Diaudit (parent = produk).
 */
exports.saveRules = async (req, res) => {
  try {
    const input = Array.isArray(req.body.rules) ? req.body.rules : [];
    if (!input.length) return errorResponse(res, 'No rule to save', 400);
    const seen = new Set();
    const parsed = input.map((r, i) => {
      const n = `Row ${i + 1}`;
      if (!mongoose.isValidObjectId(r?.sku) || !mongoose.isValidObjectId(r?.gudang)) throw new HttpError(`${n}: invalid SKU or warehouse`, 400);
      const key = `${r.sku}:${r.gudang}`;
      if (seen.has(key)) throw new HttpError(`${n}: duplicated SKU & warehouse`, 400);
      seen.add(key);
      assertGudang(req, r.gudang);
      if (isBlank(r.minQty) && isBlank(r.maxQty)) return { sku: String(r.sku), gudang: String(r.gudang), remove: true };
      const err = checkAmount(r.minQty, 'Min') || checkAmount(r.maxQty, 'Max');
      if (err) throw new HttpError(`${n}: ${err}`, 400);
      const minQty = round2(r.minQty);
      const maxQty = round2(r.maxQty);
      if (maxQty < minQty) throw new HttpError(`${n}: Max must be >= Min`, 400);
      return { sku: String(r.sku), gudang: String(r.gudang), minQty, maxQty };
    });

    const result = await runInTransaction(async () => {
      const skus = await ProdukSku.find({ _id: { $in: parsed.map((p) => p.sku) } }).select('produk').lean();
      if (skus.length !== new Set(parsed.map((p) => p.sku)).size) throw new HttpError('One or more SKUs no longer exist', 400);
      const produkOf = new Map(skus.map((s) => [String(s._id), s.produk]));
      const gudangIds = [...new Set(parsed.map((p) => p.gudang))];
      await lock([...new Set(skus.map((s) => String(s.produk)))].map((id) => ref('produk', id)), gudangIds.map((id) => ref('gudang', id)));
      if ((await Gudang.countDocuments({ _id: { $in: gudangIds } })) !== gudangIds.length) throw new HttpError('One or more warehouses are not valid', 400);

      const existing = await ReorderRule.find({ $or: parsed.map((p) => ({ sku: p.sku, gudang: p.gudang })) });
      const byKey = new Map(existing.map((r) => [`${r.sku}:${r.gudang}`, r]));
      const batchId = audit.newBatchId();
      const counts = { created: 0, updated: 0, removed: 0 };
      const now = new Date();

      for (const p of parsed) {
        const cur = byKey.get(`${p.sku}:${p.gudang}`);
        if (p.remove) {
          if (!cur) continue;
          const before = await audit.snap('reorderRule', [cur]);
          await cur.deleteOne();
          await audit.logDelete(req, 'reorderRule', before, { batchId });
          counts.removed += 1;
        } else if (cur) {
          if (cur.minQty === p.minQty && cur.maxQty === p.maxQty) continue;
          const before = await audit.snap('reorderRule', [cur]);
          cur.minQty = p.minQty;
          cur.maxQty = p.maxQty;
          cur.updatedDate = now;
          cur.updatedBy = req.user._id;
          await cur.save();
          await audit.logUpdate(req, 'reorderRule', before, [cur], { batchId });
          counts.updated += 1;
        } else {
          const doc = await ReorderRule.create({ ...p, produk: produkOf.get(p.sku), createdBy: req.user._id });
          await audit.logCreate(req, 'reorderRule', [doc], { batchId });
          counts.created += 1;
        }
      }
      return counts;
    });
    return successResponse(res, result, `Reorder levels saved (${result.created} added, ${result.updated} updated, ${result.removed} removed)`);
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- buat PO

/**
 * POST /api/reorder/create-po  body: { items: [{ sku, gudang, vendor, uomBeli, konversi, qty, hargaBeli }] }
 * Butuh juga izin purchaseOrder:create. Item dikelompokkan per vendor + gudang -> 1 DRAFT PO per kelompok
 * (semua dalam 1 transaksi). PO tetap draft supaya bisa diperiksa sebelum diterbitkan.
 */
exports.createPurchaseOrders = async (req, res) => {
  try {
    if (!hasPermission(req.user, 'purchaseOrder', 'create')) {
      return errorResponse(res, "You don't have permission to create Purchase Order", 403);
    }
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length) return errorResponse(res, 'Select at least one item', 400);
    for (const [i, it] of items.entries()) {
      if (!mongoose.isValidObjectId(it?.vendor)) return errorResponse(res, `Item ${i + 1}: please select a vendor`, 400);
      if (!mongoose.isValidObjectId(it?.gudang)) return errorResponse(res, `Item ${i + 1}: invalid warehouse`, 400);
    }

    const groups = new Map();
    items.forEach((it) => {
      const key = `${it.vendor}:${it.gudang}`;
      if (!groups.has(key)) groups.set(key, { vendor: it.vendor, gudang: it.gudang, lines: [] });
      groups.get(key).lines.push({
        sku: it.sku, uomBeli: it.uomBeli, konversi: it.konversi, qty: it.qty, hargaBeli: it.hargaBeli, note: 'Reorder',
      });
    });

    const pos = await runInTransaction(async () => {
      const created = [];
      for (const g of groups.values()) {
        const po = await createDraftPoInTransaction(req, { vendor: g.vendor, gudang: g.gudang, lines: g.lines, note: 'Created from reorder alert' });
        created.push({ _id: po._id, no: po.no, vendor: po.vendor, gudang: po.gudang, lineCount: po.lines.length, total: po.total });
      }
      return created;
    });
    return successResponse(res, pos, `${pos.length} draft PO created: ${pos.map((p) => p.no).join(', ')}`, 201);
  } catch (error) {
    return handleError(res, error);
  }
};

exports.evaluateRules = evaluateRules;
