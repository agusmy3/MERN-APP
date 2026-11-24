const ProdukSku = require('../models/ProdukSku');
const StockBalance = require('../models/StockBalance');
const StockMovement = require('../models/StockMovement');
const StockAdjustment = require('../models/StockAdjustment');
const PurchaseOrder = require('../models/PurchaseOrder');
const GoodsReceipt = require('../models/GoodsReceipt');
const CostRevaluation = require('../models/CostRevaluation');
const AuditLog = require('../models/AuditLog');
const { successResponse, errorResponse } = require('../helpers/responseHelper');
const { round2 } = require('../helpers/number');
const { hasPermission } = require('../config/permissions');
const { evaluateRules } = require('./reorderController');

const DAY = 24 * 60 * 60 * 1000;

/** Zona waktu untuk pengelompokan per hari/bulan (dari browser); tidak valid -> Asia/Jakarta */
const safeTz = (tz) => {
  try {
    if (tz) {
      Intl.DateTimeFormat('en-US', { timeZone: tz });
      return tz;
    }
  } catch { /* fallback */ }
  return 'Asia/Jakarta';
};

// ---------------------------------------------------------------- widget

/** Nilai persediaan + per gudang & kategori (data biaya) */
const inventoryWidgets = async () => {
  const rows = await StockBalance.aggregate([
    { $match: { qty: { $ne: 0 } } },
    { $lookup: { from: 'produkskus', localField: 'sku', foreignField: '_id', as: 'sku' } },
    { $unwind: '$sku' },
    { $lookup: { from: 'produks', localField: 'produk', foreignField: '_id', as: 'produk' } },
    { $unwind: '$produk' },
    {
      $project: {
        gudang: 1,
        kategori: '$produk.kategori',
        sku: '$sku._id',
        missing: { $eq: [{ $ifNull: ['$sku.avgCost', null] }, null] },
        value: { $multiply: ['$qty', { $ifNull: ['$sku.avgCost', 0] }] },
      }
    },
    {
      $facet: {
        total: [{ $group: { _id: null, value: { $sum: '$value' } } }],
        missing: [{ $match: { missing: true } }, { $group: { _id: '$sku' } }, { $count: 'n' }],
        byGudang: [
          { $group: { _id: '$gudang', value: { $sum: '$value' } } },
          { $lookup: { from: 'gudangs', localField: '_id', foreignField: '_id', as: 'g' } },
          { $project: { value: 1, label: { $first: '$g.code' }, name: { $first: '$g.name' } } },
        ],
        byKategori: [
          { $group: { _id: '$kategori', value: { $sum: '$value' } } },
          { $lookup: { from: 'kategoris', localField: '_id', foreignField: '_id', as: 'k' } },
          { $project: { value: 1, label: { $ifNull: [{ $first: '$k.name' }, '(no category)'] } } },
        ],
      }
    },
  ]);
  const f = rows[0] || {};
  const clean = (list) => (list || [])
    .map((r) => ({ id: r._id, label: r.label || '?', name: r.name, value: round2(r.value) }))
    .sort((a, b) => b.value - a.value);
  return {
    inventoryValue: round2(f.total?.[0]?.value || 0),
    skuWithoutHpp: f.missing?.[0]?.n || 0,
    valueByGudang: clean(f.byGudang),
    valueByKategori: clean(f.byKategori).slice(0, 8),
  };
};

/** Nilai GR (pembelian) per bulan, 6 bulan terakhir termasuk bulan ini (net setelah pembatalan) */
const purchasesByMonth = async (tz) => {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const rows = await StockMovement.aggregate([
    { $match: { type: 'PURCHASE', date: { $gte: from } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$date', timezone: tz } }, value: { $sum: '$value' } } },
  ]);
  const map = new Map(rows.map((r) => [r._id, round2(r.value || 0)]));
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return { key, value: map.get(key) || 0 };
  });
};

/** Qty masuk & keluar per hari, 30 hari terakhir (tanpa revaluasi; + nilai jika boleh melihat biaya) */
const movementsByDay = async (tz, withValue) => {
  const from = new Date(Date.now() - 29 * DAY);
  from.setHours(0, 0, 0, 0);
  const rows = await StockMovement.aggregate([
    { $match: { date: { $gte: from }, type: { $ne: 'REVALUATION' } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$date', timezone: tz } },
        in: { $sum: { $cond: [{ $gt: ['$qty', 0] }, '$qty', 0] } },
        out: { $sum: { $cond: [{ $lt: ['$qty', 0] }, { $abs: '$qty' }, 0] } },
        valueIn: { $sum: { $cond: [{ $gt: ['$qty', 0] }, { $ifNull: ['$value', 0] }, 0] } },
        valueOut: { $sum: { $cond: [{ $lt: ['$qty', 0] }, { $abs: { $ifNull: ['$value', 0] } }, 0] } },
      }
    },
  ]);
  const map = new Map(rows.map((r) => [r._id, r]));
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  return Array.from({ length: 30 }, (_, i) => {
    const key = fmt.format(new Date(from.getTime() + i * DAY + 12 * 60 * 60 * 1000));
    const r = map.get(key);
    return {
      key,
      in: round2(r?.in || 0),
      out: round2(r?.out || 0),
      ...(withValue ? { valueIn: round2(r?.valueIn || 0), valueOut: round2(r?.valueOut || 0) } : {}),
    };
  });
};

/** PO terbuka: jumlah, nilai sisa (sebelum pajak), dan yang terlambat */
const purchaseOrderWidgets = async () => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const [open, overdue, drafts] = await Promise.all([
    PurchaseOrder.aggregate([
      { $match: { status: { $in: ['OPEN', 'PARTIAL'] } } },
      { $unwind: '$lines' },
      {
        $group: {
          _id: '$_id',
          outstanding: {
            $sum: {
              $multiply: [
                { $max: [{ $subtract: ['$lines.qty', { $ifNull: ['$lines.qtyReceived', 0] }] }, 0] },
                '$lines.hargaBeli',
                { $subtract: [1, { $divide: [{ $ifNull: ['$lines.diskonPersen', 0] }, 100] }] },
              ]
            }
          },
        }
      },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$outstanding' } } },
    ]),
    PurchaseOrder.find({ status: { $in: ['OPEN', 'PARTIAL'] }, expectedDate: { $lt: startOfToday } })
      .select('no expectedDate status vendor').populate('vendor', 'companyName').sort({ expectedDate: 1 }).limit(5).lean(),
    PurchaseOrder.countDocuments({ status: 'DRAFT' }),
  ]);
  const overdueCount = await PurchaseOrder.countDocuments({ status: { $in: ['OPEN', 'PARTIAL'] }, expectedDate: { $lt: startOfToday } });
  return {
    openPo: { count: open[0]?.count || 0, outstandingValue: round2(open[0]?.value || 0) },
    overduePo: { count: overdueCount, items: overdue },
    poDrafts: drafts,
  };
};

// ---------------------------------------------------------------- endpoint

/**
 * GET /api/dashboard?tz=Asia/Jakarta — semua widget yang BOLEH dilihat user (cukup login).
 * Widget tanpa izin tidak dikirim sama sekali; angka biaya hanya untuk vendorPrice:view.
 */
exports.getDashboard = async (req, res) => {
  try {
    const u = req.user;
    const can = (resource) => hasPermission(u, resource, 'view');
    const canSeeCost = can('vendorPrice');
    const tz = safeTz(req.query.tz);
    const data = { canSeeCost };
    const jobs = [];

    if (can('produk')) jobs.push(ProdukSku.countDocuments({ isActive: { $ne: false } }).then((n) => { data.activeSkus = n; }));
    if (canSeeCost) jobs.push(inventoryWidgets().then((w) => Object.assign(data, w)));
    if (can('reorder')) {
      jobs.push(evaluateRules().then((rows) => {
        const counts = { OUT: 0, CRITICAL: 0, ORDERED: 0 };
        rows.forEach((r) => { if (counts[r.status] !== undefined) counts[r.status] += 1; });
        const order = { OUT: 0, CRITICAL: 1 };
        data.reorder = {
          ...counts,
          needAction: counts.OUT + counts.CRITICAL,
          items: rows.filter((r) => r.status in order)
            .sort((a, b) => order[a.status] - order[b.status] || (a.position - a.minQty) - (b.position - b.minQty))
            .slice(0, 8)
            .map((r) => ({
              sku: r.sku, produk: { _id: r.produk._id, name: r.produk.name }, gudang: r.gudang,
              onHand: r.onHand, minQty: r.minQty, uom: r.uom, status: r.status,
            })),
        };
      }));
    }
    if (can('purchaseOrder')) jobs.push(purchaseOrderWidgets().then((w) => Object.assign(data, w)));

    // pekerjaan tertunda: draft yang menunggu diposting
    const pending = {};
    if (can('stockAdjustment')) jobs.push(StockAdjustment.countDocuments({ status: 'DRAFT' }).then((n) => { pending.stockAdjustment = n; }));
    if (can('goodsReceipt')) jobs.push(GoodsReceipt.countDocuments({ status: 'DRAFT' }).then((n) => { pending.goodsReceipt = n; }));
    if (can('costRevaluation')) jobs.push(CostRevaluation.countDocuments({ status: 'DRAFT' }).then((n) => { pending.costRevaluation = n; }));

    if (can('goodsReceipt') && canSeeCost) jobs.push(purchasesByMonth(tz).then((v) => { data.purchasesByMonth = v; }));
    if (can('stockMovement')) jobs.push(movementsByDay(tz, canSeeCost).then((v) => { data.movementsByDay = v; }));

    if (can('auditLog')) {
      const { ENTITY_RESOURCE } = require('./auditLogController');
      const visible = Object.keys(ENTITY_RESOURCE).filter((e) => can(ENTITY_RESOURCE[e]));
      jobs.push(AuditLog.find({ entity: { $in: visible } })
        .select('entity entityId entityLabel action userName date batchId changes.label')
        .sort({ date: -1, _id: -1 }).limit(10).lean()
        .then((logs) => { data.recentActivity = logs; }));
    }

    await Promise.all(jobs);
    if (Object.keys(pending).length) data.pending = pending;
    return successResponse(res, data);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};
