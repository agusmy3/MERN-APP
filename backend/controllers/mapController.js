const mongoose = require('mongoose');
const Gudang = require('../models/Gudang');
const Outlet = require('../models/Outlet');
const Vendor = require('../models/Vendor');
const Customer = require('../models/Customer');
const SalesInvoice = require('../models/SalesInvoice');
const SalesReturn = require('../models/SalesReturn');
const SalesOrder = require('../models/SalesOrder');
const PurchaseInvoice = require('../models/PurchaseInvoice');
const PurchaseOrder = require('../models/PurchaseOrder');
const GoodsReceipt = require('../models/GoodsReceipt');
const StockBalance = require('../models/StockBalance');
const StockTransfer = require('../models/StockTransfer');
const PosShift = require('../models/PosShift');
const { hasPermission } = require('../config/permissions');
const { canAccessGudang } = require('../helpers/gudangAccess');
const { customerCredit } = require('../helpers/salesOrderHelper');
const { CODE_RX } = require('../helpers/regionHelper');
const { round2 } = require('../helpers/number');
const { successResponse, errorResponse } = require('../helpers/responseHelper');

/**
 * Peta lokasi (resource `map`, view). Setiap lapisan & angka ringkasan tetap mengikuti izin view resource-nya:
 * titik gudang = gudang:view, outlet = outlet:view, vendor = vendor:view, customer = customer:view.
 */
const LAYERS = ['outlet', 'gudang', 'vendor', 'customer'];
const DAY = 24 * 60 * 60 * 1000;
const can = (req, resource, action = 'view') => hasPermission(req.user, resource, action);
const canSeeReceivables = (req) => can(req, 'salesPayment') || can(req, 'salesInvoice') || can(req, 'salesReport');
const canSeePayables = (req) => can(req, 'vendorPrice') && (can(req, 'purchaseInvoice') || can(req, 'vendorPayment'));
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasPoint = (d) => d.latitude != null && d.longitude != null;
const placeOf = (d) => [d.kelurahan, d.kecamatan, d.kota].filter(Boolean).join(', ');

const safeTz = (tz) => {
  try {
    if (tz) { Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; }
  } catch { /* fallback */ }
  return 'Asia/Jakarta';
};

/** ?region=32.73 -> filter regionCode berawalan kode tsb (wilayah itu & di bawahnya) */
const regionFilter = (region) => {
  const code = String(region || '').trim();
  if (!code) return {};
  if (!CODE_RX.test(code)) return null;
  return { regionCode: { $regex: `^${escapeRx(code)}(\\.|$)` } };
};

/**
 * GET /api/map/points?region= -> { layers: { outlet|gudang|vendor|customer: { points, missing } } }
 * Hanya lapisan yang boleh dilihat. points = punya koordinat; missing = belum punya titik (untuk dilengkapi).
 * Customer walk-in tidak ditampilkan. Penanda: customer.overdue (izin piutang), outlet.shiftOpen (izin posShift).
 */
exports.getPoints = async (req, res) => {
  try {
    const rf = regionFilter(req.query.region);
    if (!rf) return errorResponse(res, 'Invalid region code', 400);
    const layers = {};
    const split = (docs, toPoint) => {
      const points = [];
      const missing = [];
      docs.forEach((d) => {
        const p = toPoint(d);
        if (hasPoint(d)) points.push({ ...p, lat: d.latitude, lng: d.longitude });
        else missing.push({ id: p.id, code: p.code, name: p.name, place: p.place, isActive: p.isActive });
      });
      return { points, missing };
    };
    const LOC = 'latitude longitude regionCode provinsi kota kecamatan kelurahan isActive';

    if (can(req, 'gudang')) {
      const docs = await Gudang.find(rf).select(`code name alamat ${LOC}`).sort({ code: 1 }).lean();
      const outletCount = new Map((await Outlet.aggregate([{ $group: { _id: '$gudang', n: { $sum: 1 } } }])).map((x) => [String(x._id), x.n]));
      layers.gudang = split(docs, (d) => ({
        id: d._id, code: d.code, name: d.name, address: d.alamat || '', place: placeOf(d), regionCode: d.regionCode,
        isActive: d.isActive !== false, accessible: canAccessGudang(req, d._id), outlets: outletCount.get(String(d._id)) || 0,
      }));
    }
    if (can(req, 'outlet')) {
      const docs = await Outlet.find(rf).select(`code name alamat phone gudang ${LOC}`).populate('gudang', 'code name').sort({ code: 1 }).lean();
      const openShift = can(req, 'posShift')
        ? new Set((await PosShift.distinct('outlet', { status: 'OPEN' })).map(String)) : null;
      layers.outlet = split(docs, (d) => ({
        id: d._id, code: d.code, name: d.name, address: d.alamat || '', place: placeOf(d), regionCode: d.regionCode,
        phone: d.phone || '', gudang: d.gudang ? `${d.gudang.code} — ${d.gudang.name}` : '', isActive: d.isActive !== false,
        ...(openShift ? { shiftOpen: openShift.has(String(d._id)) } : {}),
      }));
    }
    if (can(req, 'vendor')) {
      const docs = await Vendor.find(rf).select(`companyName picName picContact companyAddress ${LOC}`).sort({ companyName: 1 }).lean();
      layers.vendor = split(docs, (d) => ({
        id: d._id, code: '', name: d.companyName, address: d.companyAddress || '', place: placeOf(d), regionCode: d.regionCode,
        pic: [d.picName, d.picContact].filter(Boolean).join(' · '), isActive: true,
      }));
    }
    if (can(req, 'customer')) {
      const docs = await Customer.find({ ...rf, isWalkIn: { $ne: true } })
        .select(`code name phone address ${LOC}`).sort({ name: 1 }).lean();
      const overdue = canSeeReceivables(req)
        ? new Set((await SalesInvoice.distinct('customer', {
          status: 'POSTED', paymentStatus: { $in: ['UNPAID', 'PARTIAL'] }, dueDate: { $lt: startOfToday() },
        })).map(String))
        : null;
      layers.customer = split(docs, (d) => ({
        id: d._id, code: d.code, name: d.name, address: d.address || '', place: placeOf(d), regionCode: d.regionCode,
        phone: d.phone || '', isActive: d.isActive !== false,
        ...(overdue ? { overdue: overdue.has(String(d._id)) } : {}),
      }));
    }
    return successResponse(res, { layers });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

// ---------------------------------------------------------------- ringkasan per titik

const item = (label, value, format = 'text', tone = null) => ({ label, value, format, ...(tone ? { tone } : {}) });

const customerSummary = async (req, id, tz) => {
  const c = await Customer.findById(id).select('code name phone email address kota termDays creditLimit isWalkIn').lean();
  if (!c || c.isWalkIn) return null;
  const items = [item('Payment term', c.termDays ? `${c.termDays} hari` : 'Tunai')];
  {
    // posisi kredit: sama dengan GET /api/customer/:id (cukup customer:view)
    const credit = await customerCredit(c._id);
    items.push(item('Receivable', credit.receivable, 'money'));
    if (credit.deposit > 0) items.push(item('Deposit balance', credit.deposit, 'money'));
    items.push(item('Overdue', credit.overdue.amount, 'money', credit.overdue.amount > 0 ? 'danger' : null));
    if (credit.overdue.count) items.push(item('Overdue invoices', credit.overdue.count, 'number', 'danger'));
    if (credit.limit > 0) {
      items.push(item('Credit limit', credit.limit, 'money'));
      items.push(item('Credit available', credit.available, 'money', credit.available < 0 ? 'danger' : null));
    }
  }
  if (can(req, 'salesOrder')) {
    items.push(item('Active sales orders', await SalesOrder.countDocuments({ customer: c._id, status: { $in: ['OPEN', 'PARTIAL'] } }), 'number'));
  }
  if (can(req, 'salesInvoice') || can(req, 'salesReport')) {
    const from = new Date(Date.now() - 30 * DAY);
    const [inv] = await SalesInvoice.aggregate([
      { $match: { customer: c._id, status: 'POSTED', date: { $gte: from } } },
      { $group: { _id: null, dpp: { $sum: '$dpp' }, n: { $sum: 1 } } },
    ]);
    const [ret] = await SalesReturn.aggregate([
      { $match: { customer: c._id, status: 'POSTED', date: { $gte: from } } },
      { $group: { _id: null, dpp: { $sum: '$dpp' } } },
    ]);
    items.push(item('Net sales (30 days)', round2((inv?.dpp || 0) - (ret?.dpp || 0)), 'money'));
    const last = await SalesInvoice.findOne({ customer: c._id, status: 'POSTED' }).sort({ date: -1 }).select('date').lean();
    items.push(item('Last invoice', last?.date || null, 'date'));
  }
  return { title: c.name, subtitle: c.code, items, tz };
};

const vendorSummary = async (req, id) => {
  const v = await Vendor.findById(id).select('companyName picName picContact termDays').lean();
  if (!v) return null;
  const items = [
    item('PIC', [v.picName, v.picContact].filter(Boolean).join(' · ')),
    item('Payment term', v.termDays ? `${v.termDays} hari` : 'Tunai'),
  ];
  if (canSeePayables(req)) {
    const bills = await PurchaseInvoice.find({ vendor: v._id, status: 'POSTED', paymentStatus: { $in: ['UNPAID', 'PARTIAL'] } })
      .select('total returnedAmount paidAmount writtenOffAmount dueDate').lean();
    const today = startOfToday();
    let payable = 0;
    let overdue = 0;
    bills.forEach((b) => {
      const bal = round2((b.total || 0) - (b.returnedAmount || 0) - (b.paidAmount || 0) - (b.writtenOffAmount || 0));
      if (bal <= 0) return;
      payable += bal;
      if (b.dueDate && b.dueDate < today) overdue += bal;
    });
    items.push(item('Payable', round2(payable), 'money'));
    items.push(item('Overdue', round2(overdue), 'money', overdue > 0 ? 'danger' : null));
  }
  if (can(req, 'purchaseOrder')) {
    const open = await PurchaseOrder.find({ vendor: v._id, status: { $in: ['OPEN', 'PARTIAL'] } }).select('total').lean();
    items.push(item('Open purchase orders', open.length, 'number'));
    if (can(req, 'vendorPrice') && open.length) items.push(item('Open PO value', round2(open.reduce((s, p) => s + (p.total || 0), 0)), 'money'));
  }
  if (can(req, 'goodsReceipt') && can(req, 'vendorPrice')) {
    items.push(item('Receipts not billed', await GoodsReceipt.countDocuments({ vendor: v._id, status: 'POSTED', purchaseInvoice: null }), 'number'));
  }
  return { title: v.companyName, subtitle: '', items };
};

const gudangSummary = async (req, id) => {
  const g = await Gudang.findById(id).select('code name isActive').lean();
  if (!g) return null;
  const items = [item('Status', g.isActive === false ? 'Inactive' : 'Active')];
  items.push(item('Outlets supplied', await Outlet.countDocuments({ gudang: g._id }), 'number'));
  if (!canAccessGudang(req, g._id)) {
    items.push(item('Stock', 'Tidak punya akses ke gudang ini'));
    return { title: g.name, subtitle: g.code, items };
  }
  const [bal] = await StockBalance.aggregate([
    { $match: { gudang: g._id, qty: { $gt: 0 } } },
    { $group: { _id: null, skus: { $sum: 1 } } },
  ]);
  items.push(item('SKUs in stock', bal?.skus || 0, 'number'));
  if (can(req, 'vendorPrice')) {
    const [val] = await StockBalance.aggregate([
      { $match: { gudang: g._id, qty: { $gt: 0 } } },
      { $lookup: { from: 'produkskus', localField: 'sku', foreignField: '_id', as: 's' } },
      { $group: { _id: null, value: { $sum: { $multiply: ['$qty', { $ifNull: [{ $arrayElemAt: ['$s.avgCost', 0] }, 0] }] } } } },
    ]);
    items.push(item('Stock value', round2(val?.value || 0), 'money'));
  }
  if (can(req, 'reorder')) {
    const rows = await require('./reorderController').evaluateRules({ gudang: g._id });
    const need = rows.filter((r) => r.status === 'OUT' || r.status === 'CRITICAL').length;
    items.push(item('Reorder alerts', need, 'number', need > 0 ? 'danger' : null));
  }
  if (can(req, 'stockTransfer')) {
    items.push(item('Incoming transfers', await StockTransfer.countDocuments({ toGudang: g._id, status: 'IN_TRANSIT' }), 'number'));
  }
  if (can(req, 'purchaseOrder')) {
    items.push(item('Open purchase orders', await PurchaseOrder.countDocuments({ gudang: g._id, status: { $in: ['OPEN', 'PARTIAL'] } }), 'number'));
  }
  return { title: g.name, subtitle: g.code, items };
};

const outletSummary = async (req, id, tz) => {
  const o = await Outlet.findById(id).select('code name phone gudang isActive').populate('gudang', 'code name').lean();
  if (!o) return null;
  const items = [
    item('Stock from', o.gudang ? `${o.gudang.code} — ${o.gudang.name}` : '-'),
    item('Status', o.isActive === false ? 'Inactive' : 'Active'),
  ];
  if (can(req, 'posShift')) {
    const shifts = await PosShift.find({ outlet: o._id, status: 'OPEN' }).populate('cashier', 'name').select('cashier').lean();
    items.push(item('Open shifts', shifts.length ? shifts.map((s) => s.cashier?.name || '?').join(', ') : 'Tidak ada'));
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const [sales] = await SalesInvoice.aggregate([
      { $match: { outlet: o._id, source: 'POS', status: 'POSTED', date: { $gte: new Date(Date.now() - 2 * DAY) } } },
      { $match: { $expr: { $eq: [{ $dateToString: { format: '%Y-%m-%d', date: '$date', timezone: tz } }, today] } } },
      { $group: { _id: null, total: { $sum: '$total' }, n: { $sum: 1 } } },
    ]);
    items.push(item('Sales today', round2(sales?.total || 0), 'money'));
    items.push(item('Transactions today', sales?.n || 0, 'number'));
  }
  return { title: o.name, subtitle: o.code, items };
};

const SUMMARY = { customer: customerSummary, vendor: vendorSummary, gudang: gudangSummary, outlet: outletSummary };

/**
 * GET /api/map/summary/:type/:id?tz= -> { title, subtitle, items: [{ label, value, format: text|money|number|date, tone? }] }
 * "Lihat ringkasan" di popup peta; tiap angka hanya jika user punya izin datanya (lihat fungsi di atas).
 */
exports.getSummary = async (req, res) => {
  try {
    const { type, id } = req.params;
    if (!LAYERS.includes(type)) return errorResponse(res, 'Unknown map layer', 400);
    if (!can(req, type)) return errorResponse(res, `You do not have permission to view ${type}`, 403);
    if (!mongoose.isValidObjectId(id)) return errorResponse(res, 'Invalid id', 400);
    const data = await SUMMARY[type](req, id, safeTz(req.query.tz));
    if (!data) return errorResponse(res, 'Location not found', 404);
    delete data.tz;
    return successResponse(res, { type, id, ...data });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};
