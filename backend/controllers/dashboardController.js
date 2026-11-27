const mongoose = require('mongoose');
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
const { gudangFilter, gudangScope } = require('../helpers/gudangAccess');
const StockTransfer = require('../models/StockTransfer');
const { inTransitSummary } = require('./stockTransferController');
const SalesInvoice = require('../models/SalesInvoice');
const SalesReturn = require('../models/SalesReturn');

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
const inventoryWidgets = async (g) => {
  const rows = await StockBalance.aggregate([
    { $match: { qty: { $ne: 0 }, ...g } },
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

/**
 * Penjualan (invoice POSTED menurut tanggal invoice, dikurangi retur POSTED menurut tanggal retur):
 * hari ini, bulan ini, per bulan (6 bulan) & produk terlaris 30 hari. Penjualan = dpp (bersih, tanpa PPN).
 * Laba kotor (dpp - HPP) hanya jika withCost.
 */
const salesWidgets = async (tz, withCost, g) => {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 6, 1); // longgar, dipotong per kunci bulan
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const monthKey = dayKey.slice(0, 7);
  const pipeline = [
    { $match: { status: 'POSTED', date: { $gte: from }, ...g } },
    {
      $project: {
        dpp: 1,
        profit: { $subtract: ['$dpp', { $ifNull: ['$cogs', 0] }] },
        day: { $dateToString: { format: '%Y-%m-%d', date: '$date', timezone: tz } },
        month: { $dateToString: { format: '%Y-%m', date: '$date', timezone: tz } },
      }
    },
    { $group: { _id: { month: '$month', today: { $eq: ['$day', dayKey] } }, value: { $sum: '$dpp' }, profit: { $sum: '$profit' }, count: { $sum: 1 } } },
  ];
  const [rows, returnRows] = await Promise.all([SalesInvoice.aggregate(pipeline), SalesReturn.aggregate(pipeline)]);
  const byMonth = new Map();
  const today = { value: 0, profit: 0, count: 0 };
  const add = (r, sign) => {
    const m = byMonth.get(r._id.month) || { value: 0, profit: 0, count: 0 };
    m.value += sign * r.value;
    m.profit += sign * r.profit;
    if (sign > 0) m.count += r.count; // jumlah invoice (retur tidak dihitung)
    byMonth.set(r._id.month, m);
    if (r._id.today) {
      today.value += sign * r.value;
      today.profit += sign * r.profit;
      if (sign > 0) today.count += r.count;
    }
  };
  rows.forEach((r) => add(r, 1));
  returnRows.forEach((r) => add(r, -1));
  const pick = (m) => ({ value: round2(m?.value || 0), count: m?.count || 0, ...(withCost ? { grossProfit: round2(m?.profit || 0) } : {}) });
  const salesByMonth = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return { key, ...pick(byMonth.get(key)) };
  });

  // produk terlaris 30 hari: pendapatan bersih per SKU (subtotal baris x dpp/subtotal)
  const since = new Date(Date.now() - 29 * DAY);
  since.setHours(0, 0, 0, 0);
  const top = await SalesInvoice.aggregate([
    { $match: { status: 'POSTED', date: { $gte: since }, ...g } },
    { $project: { lines: 1, ratio: { $cond: [{ $gt: ['$subtotal', 0] }, { $divide: ['$dpp', '$subtotal'] }, 0] } } },
    { $unwind: '$lines' },
    { $project: { sku: '$lines.sku', qty: '$lines.qty', value: { $multiply: ['$lines.subtotal', '$ratio'] } } },
    {
      $unionWith: {
        coll: 'salesreturns',
        pipeline: [
          { $match: { status: 'POSTED', date: { $gte: since }, ...g } },
          { $unwind: '$lines' },
          { $project: { sku: '$lines.sku', qty: { $multiply: ['$lines.qty', -1] }, value: { $multiply: ['$lines.netAmount', -1] } } },
        ],
      }
    },
    { $group: { _id: '$sku', qty: { $sum: '$qty' }, value: { $sum: '$value' } } },
    { $match: { qty: { $gt: 0 } } },
    { $sort: { value: -1 } },
    { $limit: 8 },
    { $lookup: { from: 'produkskus', localField: '_id', foreignField: '_id', as: 's' } },
    { $lookup: { from: 'produks', localField: 's.produk', foreignField: '_id', as: 'p' } },
    { $project: { qty: 1, value: 1, label: { $first: '$s.sku' }, name: { $first: '$p.name' }, produk: { $first: '$p._id' } } },
  ]);

  return {
    sales: { today: pick(today), month: { key: monthKey, ...pick(byMonth.get(monthKey)) } },
    salesByMonth,
    topProducts: top.map((r) => ({ id: r._id, produk: r.produk, label: r.label || '?', name: r.name, qty: round2(r.qty), value: round2(r.value) })),
  };
};

/** Hutang vendor: sisa tagihan POSTED belum lunas + lewat jatuh tempo + jatuh tempo 7 hari ke depan */
const payablesWidget = async (scoped) => {
  const PurchaseInvoice = require('../models/PurchaseInvoice');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const week = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const match = { status: 'POSTED', paymentStatus: { $in: ['UNPAID', 'PARTIAL'] } };
  if (scoped) match.gudangs = { $in: scoped.$in.map((id) => new mongoose.Types.ObjectId(String(id))) };
  const rows = await PurchaseInvoice.aggregate([
    { $match: match },
    { $project: { balance: { $subtract: ['$total', { $add: [{ $ifNull: ['$returnedAmount', 0] }, { $ifNull: ['$paidAmount', 0] }, { $ifNull: ['$writtenOffAmount', 0] }] }] }, overdue: { $lt: ['$dueDate', today] }, dueSoon: { $and: [{ $gte: ['$dueDate', today] }, { $lt: ['$dueDate', week] }] } } },
    {
      $group: {
        _id: null,
        outstanding: { $sum: '$balance' },
        count: { $sum: 1 },
        overdue: { $sum: { $cond: ['$overdue', '$balance', 0] } },
        overdueCount: { $sum: { $cond: ['$overdue', 1, 0] } },
        dueSoon: { $sum: { $cond: ['$dueSoon', '$balance', 0] } },
      },
    },
  ]);
  const r = rows[0] || {};
  return { outstanding: round2(r.outstanding || 0), count: r.count || 0, overdue: round2(r.overdue || 0), overdueCount: r.overdueCount || 0, dueSoon: round2(r.dueSoon || 0) };
};

/** Piutang: sisa tagihan invoice POSTED yang belum lunas + yang lewat jatuh tempo */
const receivablesWidget = async (g) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rows = await SalesInvoice.aggregate([
    { $match: { status: 'POSTED', paymentStatus: { $in: ['UNPAID', 'PARTIAL'] }, ...g } },
    { $project: { balance: { $subtract: ['$total', { $add: [{ $ifNull: ['$returnedAmount', 0] }, { $ifNull: ['$paidAmount', 0] }, { $ifNull: ['$writtenOffAmount', 0] }] }] }, overdue: { $lt: ['$dueDate', today] } } },
    {
      $group: {
        _id: null,
        outstanding: { $sum: '$balance' },
        count: { $sum: 1 },
        overdue: { $sum: { $cond: ['$overdue', '$balance', 0] } },
        overdueCount: { $sum: { $cond: ['$overdue', 1, 0] } },
      }
    },
  ]);
  const r = rows[0] || {};
  // saldo deposit customer (uang muka / kelebihan bayar belum dipakai; tidak terikat gudang)
  const [dep] = await require('../models/CustomerDeposit').aggregate([
    { $match: { status: 'POSTED' } },
    { $group: { _id: null, bal: { $sum: { $subtract: ['$amount', { $add: [{ $ifNull: ['$usedAmount', 0] }, { $ifNull: ['$refundedAmount', 0] }, { $ifNull: ['$writtenOffAmount', 0] }] }] } } } },
  ]);
  return {
    outstanding: round2(r.outstanding || 0), count: r.count || 0, overdue: round2(r.overdue || 0), overdueCount: r.overdueCount || 0,
    deposits: round2(dep?.bal || 0),
  };
};

/** Nilai GR (pembelian) per bulan, 6 bulan terakhir termasuk bulan ini (net setelah pembatalan) */
const purchasesByMonth = async (tz, g) => {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const rows = await StockMovement.aggregate([
    { $match: { type: 'PURCHASE', date: { $gte: from }, ...g } },
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
const movementsByDay = async (tz, withValue, g) => {
  const from = new Date(Date.now() - 29 * DAY);
  from.setHours(0, 0, 0, 0);
  const rows = await StockMovement.aggregate([
    { $match: { date: { $gte: from }, type: { $ne: 'REVALUATION' }, ...g } },
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
const purchaseOrderWidgets = async (g) => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const [open, overdue, drafts] = await Promise.all([
    PurchaseOrder.aggregate([
      { $match: { status: { $in: ['OPEN', 'PARTIAL'] }, ...g } },
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
    PurchaseOrder.find({ status: { $in: ['OPEN', 'PARTIAL'] }, expectedDate: { $lt: startOfToday }, ...g })
      .select('no expectedDate status vendor').populate('vendor', 'companyName').sort({ expectedDate: 1 }).limit(5).lean(),
    PurchaseOrder.countDocuments({ status: 'DRAFT', ...g }),
  ]);
  const overdueCount = await PurchaseOrder.countDocuments({ status: { $in: ['OPEN', 'PARTIAL'] }, expectedDate: { $lt: startOfToday }, ...g });
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
    // semua widget per gudang dibatasi ke gudang yang boleh diakses user ({} = semua gudang)
    const scoped = gudangFilter(req);
    const g = scoped ? { gudang: scoped } : {};
    const gAgg = scoped ? { gudang: gudangFilter(req, undefined, { asObjectId: true }) } : {};
    data.gudangScope = scoped ? scoped.$in.length : null;

    if (can('produk')) jobs.push(ProdukSku.countDocuments({ isActive: { $ne: false } }).then((n) => { data.activeSkus = n; }));
    if (canSeeCost) jobs.push(inventoryWidgets(gAgg).then((w) => Object.assign(data, w)));
    if (canSeeCost || can('stockTransfer')) {
      jobs.push(inTransitSummary(gudangScope(req)).then((t) => {
        data.inTransit = { docCount: t.docCount, ...(canSeeCost ? { value: t.value } : {}) };
      }));
    }
    if (can('reorder')) {
      jobs.push(evaluateRules(g).then((rows) => {
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
    if (can('purchaseOrder')) jobs.push(purchaseOrderWidgets(gAgg).then((w) => Object.assign(data, w)));
    if (can('salesInvoice')) jobs.push(salesWidgets(tz, canSeeCost, gAgg).then((w) => Object.assign(data, w)));
    if (can('salesInvoice')) jobs.push(receivablesWidget(gAgg).then((w) => { data.receivables = w; }));
    if (can('purchaseInvoice') && canSeeCost) jobs.push(payablesWidget(scoped).then((w) => { data.payables = w; }));
    // deposit bersaldo yang sudah lama (setting payment.depositAgeAlertDays): segera dipakai / ditagih / dikonfirmasi
    const { agedDepositSummary } = require('./depositController');
    if (can('salesPayment')) jobs.push(agedDepositSummary('sales').then((w) => { if (w) (data.agedDeposits ||= {}).customer = w; }));
    if (can('vendorPayment') && canSeeCost) jobs.push(agedDepositSummary('purchase').then((w) => { if (w) (data.agedDeposits ||= {}).vendor = w; }));

    // pekerjaan tertunda: draft yang menunggu diposting
    const pending = {};
    if (can('stockAdjustment')) jobs.push(StockAdjustment.countDocuments({ status: 'DRAFT', ...g }).then((n) => { pending.stockAdjustment = n; }));
    if (can('goodsReceipt')) jobs.push(GoodsReceipt.countDocuments({ status: 'DRAFT', ...g }).then((n) => { pending.goodsReceipt = n; }));
    if (can('purchaseInvoice') && canSeeCost) jobs.push(GoodsReceipt.countDocuments({ status: 'POSTED', purchaseInvoice: null, ...g }).then((n) => { pending.grToBill = n; }));
    if (can('purchaseReturn')) jobs.push(require('../models/PurchaseReturn').countDocuments({ status: 'DRAFT', ...g }).then((n) => { pending.purchaseReturn = n; }));
    if (can('stockTransfer')) {
      // draft yang menunggu dikirim (gudang asal) & kiriman yang menunggu diterima (gudang tujuan)
      const from = scoped ? { fromGudang: scoped } : {};
      const to = scoped ? { toGudang: scoped } : {};
      jobs.push(StockTransfer.countDocuments({ status: 'DRAFT', ...from }).then((n) => { pending.stockTransfer = n; }));
      jobs.push(StockTransfer.countDocuments({ status: 'IN_TRANSIT', ...to }).then((n) => { pending.transferIncoming = n; }));
    }
    if (can('salesInvoice')) jobs.push(SalesInvoice.countDocuments({ status: 'DRAFT', ...g }).then((n) => { pending.salesInvoice = n; }));
    if (can('salesOrder')) {
      const SalesOrder = require('../models/SalesOrder');
      jobs.push(SalesOrder.countDocuments({ status: 'DRAFT', ...g }).then((n) => { pending.salesOrder = n; }));
      // SO terkonfirmasi yang belum selesai dikirim
      jobs.push(SalesOrder.countDocuments({ status: { $in: ['OPEN', 'PARTIAL'] }, ...g }).then((n) => { pending.soToDeliver = n; }));
    }
    if (can('deliveryOrder')) {
      const DeliveryOrder = require('../models/DeliveryOrder');
      jobs.push(DeliveryOrder.countDocuments({ status: 'DRAFT', ...g }).then((n) => { pending.deliveryOrder = n; }));
      jobs.push(DeliveryOrder.countDocuments({ status: 'POSTED', invoice: null, ...g }).then((n) => { pending.doToInvoice = n; }));
    }
    if (can('costRevaluation')) jobs.push(CostRevaluation.countDocuments({ status: 'DRAFT' }).then((n) => { pending.costRevaluation = n; }));

    if (can('goodsReceipt') && canSeeCost) jobs.push(purchasesByMonth(tz, gAgg).then((v) => { data.purchasesByMonth = v; }));
    if (can('stockMovement')) jobs.push(movementsByDay(tz, canSeeCost, gAgg).then((v) => { data.movementsByDay = v; }));

    if (can('auditLog')) {
      const { visibleEntities, gudangLogFilter } = require('./auditLogController');
      // izin per entity (termasuk data biaya) + akses gudang
      const g = gudangLogFilter(req);
      const logFilter = { entity: { $in: visibleEntities(u) } };
      jobs.push(AuditLog.find(g ? { $and: [logFilter, g] } : logFilter)
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
