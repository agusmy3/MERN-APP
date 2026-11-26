const mongoose = require('mongoose');
const SalesInvoice = require('../models/SalesInvoice');
const Customer = require('../models/Customer');
const ProdukSku = require('../models/ProdukSku');
const Produk = require('../models/Produk');
const Kategori = require('../models/Kategori');
const { hasPermission } = require('../config/permissions');
const { successResponse, errorResponse } = require('../helpers/responseHelper');
const { HttpError } = require('../helpers/transaction');
const { round2 } = require('../helpers/number');
const { gudangFilter } = require('../helpers/gudangAccess');

const GROUPS = ['day', 'month', 'customer', 'produk', 'kategori', 'sku'];
const DAY = 24 * 60 * 60 * 1000;

const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status);
  return errorResponse(res, error.message, 500);
};

const safeTz = (tz) => {
  try {
    if (tz) {
      Intl.DateTimeFormat('en-US', { timeZone: tz });
      return tz;
    }
  } catch { /* fallback */ }
  return 'Asia/Jakarta';
};

/** Filter dokumen (invoice & retur): gudang (dibatasi akses), customer. ObjectId untuk aggregate. */
const docMatch = (req) => {
  const match = { status: 'POSTED' };
  if (req.query.gudang && !mongoose.isValidObjectId(req.query.gudang)) throw new HttpError('Invalid warehouse', 400);
  const g = gudangFilter(req, req.query.gudang || undefined, { asObjectId: true });
  if (g !== undefined) match.gudang = g;
  if (req.query.customer) {
    if (!mongoose.isValidObjectId(req.query.customer)) throw new HttpError('Invalid customer', 400);
    match.customer = new mongoose.Types.ObjectId(String(req.query.customer));
  }
  return match;
};

/**
 * GET /api/sales-report/sales?from=&to=&groupBy=day|month|customer|produk|kategori|sku&gudang=&customer=&tz=
 * Penjualan bersih per kelompok: invoice POSTED (menurut tanggal invoice) dikurangi retur POSTED
 * (menurut tanggal retur). Nilai = dpp (tanpa PPN, setelah diskon dokumen, proporsional per baris).
 * -> { rows: [{ key, label, sub, qty?, invoiceCount, sales, returns, net, cogs?, grossProfit?, margin? }], totals, canSeeCost }
 * Default periode = bulan berjalan. HPP & laba hanya untuk vendorPrice:view.
 */
exports.getSalesReport = async (req, res) => {
  try {
    const groupBy = GROUPS.includes(req.query.groupBy) ? req.query.groupBy : 'day';
    const tz = safeTz(req.query.tz);
    const now = new Date();
    const from = req.query.from ? new Date(`${req.query.from}T00:00:00`) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = req.query.to ? new Date(`${req.query.to}T23:59:59.999`) : now;
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return errorResponse(res, 'Invalid date', 400);
    if (to < from) return errorResponse(res, 'End date must be after start date', 400);
    if (to - from > 366 * 2 * DAY) return errorResponse(res, 'Maximum period is 2 years', 400);
    const match = { ...docMatch(req), date: { $gte: from, $lte: to } };
    const canSeeCost = hasPermission(req.user, 'vendorPrice', 'view');

    const lineFields = (sign, netExpr) => ({
      doc: '$_id',
      date: 1,
      customer: 1,
      sku: '$lines.sku',
      produk: '$lines.produk',
      qty: { $multiply: ['$lines.qty', sign] },
      net: { $multiply: [netExpr, sign] },
      cost: { $multiply: ['$lines.qty', { $ifNull: ['$lines.unitCost', 0] }, sign] },
      isSale: { $eq: [sign, 1] },
    });
    const keyExpr = {
      day: { $dateToString: { format: '%Y-%m-%d', date: '$date', timezone: tz } },
      month: { $dateToString: { format: '%Y-%m', date: '$date', timezone: tz } },
      customer: '$customer',
      produk: '$produk',
      sku: '$sku',
      kategori: '$kategori',
    }[groupBy];

    const pipeline = [
      { $match: match },
      { $project: { date: 1, customer: 1, lines: 1, ratio: { $cond: [{ $gt: ['$subtotal', 0] }, { $divide: ['$dpp', '$subtotal'] }, 0] } } },
      { $unwind: '$lines' },
      { $project: lineFields(1, { $multiply: ['$lines.subtotal', '$ratio'] }) },
      {
        $unionWith: {
          coll: 'salesreturns',
          pipeline: [
            { $match: match },
            { $unwind: '$lines' },
            { $project: lineFields(-1, '$lines.netAmount') },
          ],
        }
      },
      ...(groupBy === 'kategori' ? [
        { $lookup: { from: 'produks', localField: 'produk', foreignField: '_id', as: 'p' } },
        { $set: { kategori: { $first: '$p.kategori' } } },
      ] : []),
      {
        $group: {
          _id: keyExpr,
          qty: { $sum: '$qty' },
          sales: { $sum: { $cond: ['$isSale', '$net', 0] } },
          returns: { $sum: { $cond: ['$isSale', 0, { $multiply: ['$net', -1] }] } },
          cost: { $sum: '$cost' },
          docs: { $addToSet: { $cond: ['$isSale', '$doc', '$$REMOVE'] } },
        }
      },
    ];
    const groups = await SalesInvoice.aggregate(pipeline);

    // label per kelompok
    const ids = groups.map((g) => g._id).filter((id) => id && mongoose.isValidObjectId(id));
    const labels = new Map();
    if (groupBy === 'customer') {
      (await Customer.find({ _id: { $in: ids } }).select('code name').lean())
        .forEach((c) => labels.set(String(c._id), { label: c.name, sub: c.code }));
    } else if (groupBy === 'produk') {
      (await Produk.find({ _id: { $in: ids } }).select('name uom').populate('uom', 'code').lean())
        .forEach((p) => labels.set(String(p._id), { label: p.name, uom: p.uom?.code || '' }));
    } else if (groupBy === 'sku') {
      (await ProdukSku.find({ _id: { $in: ids } }).select('sku produk variantValues').populate({ path: 'produk', select: 'name uom', populate: { path: 'uom', select: 'code' } }).lean())
        .forEach((s) => labels.set(String(s._id), {
          label: s.sku,
          sub: `${s.produk?.name || ''} · ${(s.variantValues || []).map((v) => v.value).join(' / ') || 'Default'}`,
          produk: s.produk?._id,
          uom: s.produk?.uom?.code || '',
        }));
    } else if (groupBy === 'kategori') {
      (await Kategori.find({ _id: { $in: ids } }).select('name').lean())
        .forEach((k) => labels.set(String(k._id), { label: k.name }));
    }

    const withQty = groupBy === 'produk' || groupBy === 'sku';
    const rows = groups.map((g) => {
      const key = g._id === null || g._id === undefined ? '' : String(g._id);
      const meta = labels.get(key) || {};
      const net = round2(g.sales - g.returns);
      const row = {
        key,
        label: meta.label || (groupBy === 'kategori' && !key ? '(no category)' : key || '(unknown)'),
        sub: meta.sub,
        produk: meta.produk,
        uom: meta.uom,
        invoiceCount: g.docs.length,
        sales: round2(g.sales),
        returns: round2(g.returns),
        net,
      };
      if (withQty) row.qty = round2(g.qty);
      if (canSeeCost) {
        row.cogs = round2(g.cost);
        row.grossProfit = round2(net - g.cost);
        row.margin = net ? round2(((net - g.cost) / net) * 100) : null;
      }
      return row;
    });
    if (groupBy === 'day' || groupBy === 'month') rows.sort((a, b) => a.key.localeCompare(b.key));
    else rows.sort((a, b) => b.net - a.net);

    const sum = (f) => round2(rows.reduce((s, r) => s + (r[f] || 0), 0));
    const invoiceCount = (await SalesInvoice.distinct('_id', match)).length;
    // ongkir yang ditagih (tanpa PPN): pendapatan terpisah, tidak termasuk penjualan barang / laba kotor
    const ship = await SalesInvoice.aggregate([{ $match: match }, { $group: { _id: null, v: { $sum: { $ifNull: ['$shippingDpp', 0] } } } }]);
    const totals = { sales: sum('sales'), returns: sum('returns'), net: sum('net'), invoiceCount, shipping: round2(ship[0]?.v || 0) };
    if (canSeeCost) {
      totals.cogs = sum('cogs');
      totals.grossProfit = round2(totals.net - totals.cogs);
      totals.margin = totals.net ? round2((totals.grossProfit / totals.net) * 100) : null;
    }
    return successResponse(res, { groupBy, from, to, rows, totals, canSeeCost });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * GET /api/sales-report/aging?gudang=&customer= — umur piutang SAAT INI per customer.
 * Invoice POSTED yang belum lunas (UNPAID / PARTIAL), sisa = total - retur - dibayar, dikelompokkan
 * menurut hari lewat jatuh tempo: current (belum jatuh tempo), 1-30, 31-60, 61-90, >90.
 */
exports.getAgingReport = async (req, res) => {
  try {
    const match = { ...docMatch(req), paymentStatus: { $in: ['UNPAID', 'PARTIAL'] } };
    const invoices = await SalesInvoice.find(SalesInvoice.where(match).cast(SalesInvoice))
      .select('no date dueDate total returnedAmount paidAmount customer gudang')
      .populate('gudang', 'code')
      .sort({ dueDate: 1, date: 1 })
      .lean();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90'];
    const bucketOf = (days) => (days <= 0 ? 'current' : days <= 30 ? 'd1_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90');
    const empty = () => Object.fromEntries([...BUCKETS, 'total'].map((b) => [b, 0]));

    const byCustomer = new Map();
    const totals = empty();
    for (const inv of invoices) {
      const balance = round2(inv.total - (inv.returnedAmount || 0) - (inv.paidAmount || 0));
      if (balance <= 0) continue;
      const due = inv.dueDate ? new Date(inv.dueDate) : new Date(inv.date);
      due.setHours(0, 0, 0, 0);
      const daysOverdue = Math.round((today - due) / DAY);
      const bucket = bucketOf(daysOverdue);
      const key = String(inv.customer);
      if (!byCustomer.has(key)) byCustomer.set(key, { customer: key, ...empty(), invoices: [] });
      const c = byCustomer.get(key);
      c[bucket] = round2(c[bucket] + balance);
      c.total = round2(c.total + balance);
      totals[bucket] = round2(totals[bucket] + balance);
      totals.total = round2(totals.total + balance);
      c.invoices.push({ _id: inv._id, no: inv.no, date: inv.date, dueDate: inv.dueDate, gudang: inv.gudang?.code, total: inv.total, balance, daysOverdue, bucket });
    }
    const customers = new Map((await Customer.find({ _id: { $in: [...byCustomer.keys()] } }).select('code name phone termDays').lean())
      .map((c) => [String(c._id), c]));
    const rows = [...byCustomer.values()]
      .map((r) => ({ ...r, customer: customers.get(r.customer) || { _id: r.customer, name: '(deleted)' } }))
      .sort((a, b) => (b.total - b.current) - (a.total - a.current) || b.total - a.total);
    return successResponse(res, { asOf: today, rows, totals });
  } catch (error) {
    return handleError(res, error);
  }
};
