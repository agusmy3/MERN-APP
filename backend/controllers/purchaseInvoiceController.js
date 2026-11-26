const mongoose = require('mongoose');
const PurchaseInvoice = require('../models/PurchaseInvoice');
const GoodsReceipt = require('../models/GoodsReceipt');
const PurchaseOrder = require('../models/PurchaseOrder');
const PurchaseReturn = require('../models/PurchaseReturn');
const VendorPayment = require('../models/VendorPayment');
const Vendor = require('../models/Vendor');
const { successResponse, errorResponse } = require('../helpers/responseHelper');
const audit = require('../helpers/auditLogger');
const { runInTransaction, HttpError, lock, ref } = require('../helpers/transaction');
const { nextDocNo } = require('../helpers/stockHelper');
const { round2 } = require('../helpers/number');
const { lineSubtotal } = require('../helpers/purchaseHelper');
const { invoiceBalance } = require('../helpers/salesHelper');
const { assertGudang, gudangScope } = require('../helpers/gudangAccess');

/**
 * Tagihan vendor (lihat models/PurchaseInvoice.js). Izin: purchaseInvoice view / create (buat tagihan, langsung
 * POSTED) / update (batalkan) + vendorPrice:view (dipasang di route: tagihan = data harga beli).
 */
const SORTABLE_FIELDS = ['no', 'date', 'dueDate', 'total', 'createdDate'];
const DAY = 24 * 60 * 60 * 1000;
const MAX_RECEIPTS = 50;

const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status);
  if (error.name === 'ValidationError' || error.name === 'CastError') return errorResponse(res, error.message, 400);
  return errorResponse(res, error.message, 500);
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const trimText = (v, max = 500) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const idList = (v) => (Array.isArray(v) ? [...new Set(v.map(String))] : []);

/** Filter akses gudang: tagihan terlihat jika salah satu gudang GR-nya boleh diakses */
const applyScope = (req, filter) => {
  const scope = gudangScope(req);
  if (scope) filter.gudangs = { $in: scope.map((id) => new mongoose.Types.ObjectId(id)) };
  return filter;
};

/** Nilai hutang 1 baris PO untuk qty (satuan beli): harga x (1 - diskon) x (1 + PPN PO) */
const lineAmount = (po, poLine, qty) => round2(lineSubtotal({ qty, hargaBeli: poLine.hargaBeli, diskonPersen: poLine.diskonPersen || 0 }) * (1 + (po.taxRate || 0) / 100));

/** Sisa hutang & status bayar (sama dengan invoice penjualan: total - retur - dibayar) */
const billBalance = invoiceBalance;

// ---------------------------------------------------------------- baca

/**
 * GET /api/purchase-invoice — filter search (no / no. faktur vendor / vendor), status, paymentStatus
 * (OPEN = UNPAID+PARTIAL, OVERDUE = OPEN lewat jatuh tempo, atau status), vendor, from, to. + balance, overdue
 */
exports.getInvoices = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || 1) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || 10) || 10, 1), 100);
    const sortField = SORTABLE_FIELDS.includes(req.query.sortField) ? req.query.sortField : 'createdDate';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const filter = applyScope(req, {});
    if (['POSTED', 'CANCELLED'].includes(req.query.status)) filter.status = req.query.status;
    const ps = req.query.paymentStatus;
    if (ps === 'OPEN' || ps === 'OVERDUE') {
      Object.assign(filter, { status: 'POSTED', paymentStatus: { $in: ['UNPAID', 'PARTIAL'] } });
      if (ps === 'OVERDUE') filter.dueDate = { $lt: startOfDay(new Date()) };
    } else if (['UNPAID', 'PARTIAL', 'PAID', 'OVERPAID'].includes(ps)) Object.assign(filter, { status: 'POSTED', paymentStatus: ps });
    if (req.query.vendor) {
      if (!mongoose.isValidObjectId(req.query.vendor)) return errorResponse(res, 'Invalid vendor', 400);
      filter.vendor = req.query.vendor;
    }
    if (req.query.from || req.query.to) {
      filter.date = {};
      if (req.query.from) filter.date.$gte = new Date(`${req.query.from}T00:00:00`);
      if (req.query.to) filter.date.$lte = new Date(`${req.query.to}T23:59:59.999`);
    }
    if (req.query.search) {
      const rx = { $regex: escapeRegex(req.query.search), $options: 'i' };
      const vendors = await Vendor.find({ companyName: rx }).distinct('_id');
      filter.$or = [{ no: rx }, { vendorInvoiceNo: rx }, { note: rx }, { vendor: { $in: vendors } }];
    }
    const [totalData, rows] = await Promise.all([
      PurchaseInvoice.countDocuments(filter),
      PurchaseInvoice.find(filter)
        .select('-lines -charges')
        .populate('vendor', 'companyName')
        .populate('goodsReceipts', 'no')
        .populate('createdBy', 'name')
        .populate('updatedBy', 'name')
        .sort({ [sortField]: sortOrder, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);
    const today = startOfDay(new Date());
    rows.forEach((r) => {
      r.balance = r.status === 'POSTED' ? billBalance(r).balance : 0;
      r.overdue = r.status === 'POSTED' && r.balance > 0 && r.dueDate < today;
    });
    return successResponse(res, { dataPurchaseInvoice: rows, totalData, currentPage: page, totalPages: Math.ceil(totalData / pageSize) });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * GET /api/purchase-invoice/billable?vendor= — yang bisa ditagih vendor ini:
 * goods: GR POSTED vendor ini yang belum ditagih (+ nilai perkiraan, PPN PO, draft retur);
 * freight: GR POSTED dengan biaya angkut yang ditagih vendor ini (freightVendor, default vendor PO) & belum ditagih.
 */
exports.getBillable = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.query.vendor)) return errorResponse(res, 'Please select a vendor', 400);
    const vendorId = new mongoose.Types.ObjectId(String(req.query.vendor));
    const vendor = await Vendor.findById(vendorId).select('companyName termDays').lean();
    if (!vendor) return errorResponse(res, 'Vendor not found', 404);
    const scope = gudangScope(req);
    const gudangFilter = scope ? { gudang: { $in: scope } } : {};
    const [goods, freight] = await Promise.all([
      GoodsReceipt.find({ vendor: vendorId, status: 'POSTED', purchaseInvoice: null, ...gudangFilter })
        .select('no date gudang purchaseOrder deliveryNoteNo lines')
        .populate('gudang', 'code').populate('purchaseOrder', 'no taxRate lines').sort({ date: 1 }).lean(),
      GoodsReceipt.find({
        status: 'POSTED', freightInvoice: null, freightCharge: { $gt: 0 }, ...gudangFilter,
        $or: [{ freightVendor: vendorId }, { freightVendor: null, vendor: vendorId }],
      }).select('no date gudang vendor freightCharge freightNote').populate('gudang', 'code').populate('vendor', 'companyName').sort({ date: 1 }).lean(),
    ]);
    const drafts = new Set((await PurchaseReturn.find({ goodsReceipt: { $in: goods.map((g) => g._id) }, status: 'DRAFT' }).distinct('goodsReceipt')).map(String));
    const goodsRows = goods.map((g) => {
      const po = g.purchaseOrder;
      const poLines = new Map((po?.lines || []).map((l) => [String(l._id), l]));
      const amount = round2(g.lines.reduce((s, l) => {
        const pl = poLines.get(String(l.poLine));
        const qty = round2(l.qty - (l.qtyReturned || 0));
        return s + (pl && qty > 0 ? lineAmount(po, pl, qty) : 0);
      }, 0));
      return {
        _id: g._id, no: g.no, date: g.date, gudang: g.gudang, deliveryNoteNo: g.deliveryNoteNo,
        purchaseOrder: po ? { _id: po._id, no: po.no } : null, taxRate: po?.taxRate || 0, amount, hasDraftReturn: drafts.has(String(g._id)),
      };
    }).filter((g) => g.amount > 0 || g.hasDraftReturn);
    return successResponse(res, {
      vendor,
      goods: goodsRows,
      freight: freight.map((g) => ({ _id: g._id, no: g.no, date: g.date, gudang: g.gudang, supplier: g.vendor, amount: g.freightCharge, freightNote: g.freightNote })),
    });
  } catch (error) {
    return handleError(res, error);
  }
};

const populateBill = (q) => q
  .populate('vendor', 'companyName picName picContact companyAddress kota termDays')
  .populate('goodsReceipts', 'no date deliveryNoteNo purchaseOrder')
  .populate('freightReceipts', 'no date freightNote vendor')
  .populate('gudangs', 'code')
  .populate('lines.sku', 'sku variantValues')
  .populate({ path: 'lines.produk', select: 'name uom', populate: { path: 'uom', select: 'code' } })
  .populate('lines.uomBeli', 'code')
  .populate('lines.goodsReceipt', 'no')
  .populate('charges.goodsReceipt', 'no')
  .populate('createdBy', 'name')
  .populate('postedBy', 'name')
  .populate('cancelledBy', 'name');

/** GET /api/purchase-invoice/:id — + balance, overdue, payments, returns */
exports.getInvoice = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 'Vendor bill not found', 404);
    const doc = await populateBill(PurchaseInvoice.findOne(applyScope(req, { _id: req.params.id }))).lean();
    if (!doc) return errorResponse(res, 'Vendor bill not found', 404);
    doc.balance = doc.status === 'POSTED' ? billBalance(doc).balance : 0;
    doc.overdue = doc.status === 'POSTED' && doc.balance > 0 && doc.dueDate < startOfDay(new Date());
    const grIds = (doc.goodsReceipts || []).map((g) => g._id);
    const [payments, returns, pos] = await Promise.all([
      VendorPayment.find({ purchaseInvoice: doc._id }).populate('createdBy', 'name').populate('cancelledBy', 'name').sort({ createdDate: 1 }).lean(),
      PurchaseReturn.find({ goodsReceipt: { $in: grIds }, status: { $ne: 'CANCELLED' } }).select('no date status total resolution purchaseInvoice goodsReceipt').sort({ createdDate: 1 }).lean(),
      PurchaseOrder.find({ _id: { $in: (doc.goodsReceipts || []).map((g) => g.purchaseOrder) } }).select('no').lean(),
    ]);
    doc.payments = payments;
    doc.returns = returns;
    doc.purchaseOrders = pos;
    return successResponse(res, doc);
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * GET /api/purchase-invoice/aging?vendor= — umur hutang saat ini per vendor (tagihan belum lunas):
 * current (belum jatuh tempo), d1_30, d31_60, d61_90, d90 (hari lewat jatuh tempo) + total; detail per tagihan.
 */
exports.getAging = async (req, res) => {
  try {
    const filter = applyScope(req, { status: 'POSTED', paymentStatus: { $in: ['UNPAID', 'PARTIAL'] } });
    if (req.query.vendor) {
      if (!mongoose.isValidObjectId(req.query.vendor)) return errorResponse(res, 'Invalid vendor', 400);
      filter.vendor = req.query.vendor;
    }
    const bills = await PurchaseInvoice.find(filter).select('no date dueDate vendor vendorInvoiceNo total returnedAmount paidAmount')
      .populate('vendor', 'companyName').sort({ dueDate: 1 }).lean();
    const today = startOfDay(new Date());
    const bucketOf = (days) => (days <= 0 ? 'current' : days <= 30 ? 'd1_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90');
    const KEYS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90'];
    const byVendor = new Map();
    const totals = Object.fromEntries([...KEYS, 'total'].map((k) => [k, 0]));
    bills.forEach((b) => {
      const { balance } = billBalance(b);
      if (balance <= 0) return;
      const daysOverdue = Math.floor((today - startOfDay(b.dueDate)) / DAY);
      const bucket = bucketOf(daysOverdue);
      const key = String(b.vendor?._id);
      const row = byVendor.get(key) || { vendor: b.vendor, ...Object.fromEntries([...KEYS, 'total'].map((k) => [k, 0])), bills: [] };
      row[bucket] = round2(row[bucket] + balance);
      row.total = round2(row.total + balance);
      row.bills.push({ _id: b._id, no: b.no, vendorInvoiceNo: b.vendorInvoiceNo, date: b.date, dueDate: b.dueDate, total: b.total, balance, bucket, daysOverdue: Math.max(daysOverdue, 0) });
      byVendor.set(key, row);
      totals[bucket] = round2(totals[bucket] + balance);
      totals.total = round2(totals.total + balance);
    });
    const rows = [...byVendor.values()].sort((a, b) => b.total - a.total);
    return successResponse(res, { rows, totals });
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- buat & batal

/**
 * POST /api/purchase-invoice  body: { vendor, goodsReceipts: [id], freightReceipts: [id], vendorInvoiceNo, date, dueDate, note }
 * Tagihan langsung POSTED. Barang: GR POSTED vendor ini yang belum ditagih, tanpa draft retur, PPN PO sama;
 * qty = qty GR - diretur. Biaya angkut: GR yang angkutnya ditagih vendor ini. Jatuh tempo default = tanggal + termin vendor.
 */
exports.createInvoice = async (req, res) => {
  try {
    const body = req.body || {};
    if (!mongoose.isValidObjectId(body.vendor)) return errorResponse(res, 'Please select a vendor', 400);
    const goodsIds = idList(body.goodsReceipts);
    const freightIds = idList(body.freightReceipts);
    if (!goodsIds.length && !freightIds.length) return errorResponse(res, 'Select at least one goods receipt or freight charge', 400);
    if (goodsIds.length + freightIds.length > MAX_RECEIPTS) return errorResponse(res, `At most ${MAX_RECEIPTS} receipts per bill`, 400);
    if ([...goodsIds, ...freightIds].some((id) => !mongoose.isValidObjectId(id))) return errorResponse(res, 'Invalid goods receipt', 400);
    const date = body.date ? new Date(body.date) : new Date();
    if (Number.isNaN(date.getTime())) return errorResponse(res, 'Invalid bill date', 400);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    if (date > endOfToday) return errorResponse(res, 'Bill date cannot be in the future', 400);
    let dueDate = null;
    if (body.dueDate) {
      dueDate = new Date(body.dueDate);
      if (Number.isNaN(dueDate.getTime())) return errorResponse(res, 'Invalid due date', 400);
      if (dueDate < startOfDay(date)) return errorResponse(res, 'Due date cannot be before the bill date', 400);
    }

    const doc = await runInTransaction(async () => {
      await lock(ref('vendor', body.vendor), [...goodsIds, ...freightIds].map((id) => ref('goodsReceipt', id)));
      const vendor = await Vendor.findById(body.vendor).select('companyName termDays').lean();
      if (!vendor) throw new HttpError('Vendor not found', 404);
      const goods = await GoodsReceipt.find({ _id: { $in: goodsIds } }).sort({ date: 1, no: 1 });
      const freight = await GoodsReceipt.find({ _id: { $in: freightIds } }).sort({ date: 1, no: 1 });
      if (goods.length !== goodsIds.length || freight.length !== freightIds.length) throw new HttpError('Goods receipt not found', 404);
      [...goods, ...freight].forEach((g) => assertGudang(req, g.gudang));

      for (const g of goods) {
        if (g.status !== 'POSTED') throw new HttpError(`${g.no}: only posted goods receipts can be billed`, 400);
        if (String(g.vendor) !== String(vendor._id)) throw new HttpError(`${g.no} is not from ${vendor.companyName}`, 400);
        if (g.purchaseInvoice) throw new HttpError(`${g.no} is already billed`, 400);
      }
      for (const g of freight) {
        if (g.status !== 'POSTED') throw new HttpError(`${g.no}: only posted goods receipts can be billed`, 400);
        if (!(g.freightCharge > 0)) throw new HttpError(`${g.no} has no freight charge`, 400);
        if (String(g.freightVendor || g.vendor) !== String(vendor._id)) throw new HttpError(`Freight of ${g.no} is not billed by ${vendor.companyName}`, 400);
        if (g.freightInvoice) throw new HttpError(`Freight of ${g.no} is already billed`, 400);
      }
      const draftReturn = await PurchaseReturn.findOne({ goodsReceipt: { $in: goodsIds }, status: 'DRAFT' }).select('no').lean();
      if (draftReturn) throw new HttpError(`Post or delete draft purchase return ${draftReturn.no} first`, 400);

      const pos = await PurchaseOrder.find({ _id: { $in: goods.map((g) => g.purchaseOrder) } }).lean();
      const poById = new Map(pos.map((p) => [String(p._id), p]));
      const rates = new Set(pos.map((p) => p.taxRate || 0));
      if (rates.size > 1) throw new HttpError('Goods receipts have different PPN rates on their purchase orders. Bill them separately.', 400);
      const taxRate = pos.length ? (pos[0].taxRate || 0) : 0;

      const lines = [];
      for (const g of goods) {
        const po = poById.get(String(g.purchaseOrder));
        if (!po) throw new HttpError(`Purchase order of ${g.no} no longer exists`, 400);
        for (const l of g.lines) {
          const qty = round2(l.qty - (l.qtyReturned || 0));
          if (qty <= 0) continue;
          const pl = po.lines.find((x) => String(x._id) === String(l.poLine));
          if (!pl) throw new HttpError(`${g.no}: line no longer matches the purchase order`, 400);
          const line = { goodsReceipt: g._id, poLine: l.poLine, sku: l.sku, produk: l.produk, uomBeli: l.uomBeli, qty, hargaBeli: pl.hargaBeli, diskonPersen: pl.diskonPersen || 0 };
          line.subtotal = lineSubtotal(line);
          lines.push(line);
        }
      }
      const charges = freight.map((g) => ({ goodsReceipt: g._id, description: [`Freight ${g.no}`, g.freightNote].filter(Boolean).join(' · ').slice(0, 200), amount: g.freightCharge }));
      if (!lines.length && !charges.length) throw new HttpError('Nothing left to bill (all goods were returned)', 400);

      const subtotal = round2(lines.reduce((s, l) => s + l.subtotal, 0));
      const taxAmount = round2(subtotal * taxRate / 100);
      const freightTotal = round2(charges.reduce((s, c) => s + c.amount, 0));
      const doc = new PurchaseInvoice({
        no: await nextDocNo('BILL'),
        vendor: vendor._id,
        vendorInvoiceNo: trimText(body.vendorInvoiceNo, 100),
        date,
        dueDate: dueDate || new Date(startOfDay(date).getTime() + (vendor.termDays || 0) * DAY),
        goodsReceipts: goods.map((g) => g._id),
        freightReceipts: freight.map((g) => g._id),
        gudangs: [...new Set([...goods, ...freight].map((g) => String(g.gudang)))],
        status: 'POSTED',
        taxRate,
        lines,
        charges,
        subtotal,
        taxAmount,
        freightTotal,
        total: round2(subtotal + taxAmount + freightTotal),
        returnedAmount: 0,
        paidAmount: 0,
        note: trimText(body.note),
        postedBy: req.user._id,
        postedDate: new Date(),
        createdBy: req.user._id,
      });
      doc.paymentStatus = billBalance(doc).paymentStatus;
      await doc.save();

      const batchId = audit.newBatchId();
      await audit.logCreate(req, 'purchaseInvoice', [doc], { batchId });
      for (const g of goods) {
        const before = await audit.snap('goodsReceipt', [g]);
        g.purchaseInvoice = doc._id;
        if (freightIds.includes(String(g._id))) g.freightInvoice = doc._id;
        await g.save();
        await audit.logUpdate(req, 'goodsReceipt', before, [g], { batchId });
      }
      for (const g of freight) {
        if (goodsIds.includes(String(g._id))) continue;
        const before = await audit.snap('goodsReceipt', [g]);
        g.freightInvoice = doc._id;
        await g.save();
        await audit.logUpdate(req, 'goodsReceipt', before, [g], { batchId });
      }
      return doc;
    });
    return successResponse(res, doc, `${doc.no} created`, 201);
  } catch (error) {
    return handleError(res, error);
  }
};

/** POST /api/purchase-invoice/:id/cancel { reason } — hanya jika tidak ada pembayaran aktif; GR bisa ditagih ulang */
exports.cancelInvoice = async (req, res) => {
  try {
    const reason = trimText(req.body?.reason);
    if (!reason) return errorResponse(res, 'Cancellation reason is required', 400);
    if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 'Vendor bill not found', 404);
    const doc = await runInTransaction(async () => {
      await lock(ref('purchaseInvoice', req.params.id));
      const doc = await PurchaseInvoice.findOne(applyScope(req, { _id: req.params.id }));
      if (!doc) throw new HttpError('Vendor bill not found', 404);
      if (doc.status !== 'POSTED') throw new HttpError('Vendor bill is already cancelled', 400);
      const payments = await VendorPayment.countDocuments({ purchaseInvoice: doc._id, status: 'POSTED' });
      if (payments) throw new HttpError(`Vendor bill has ${payments} payment(s). Cancel them first.`, 400);
      const ids = [...new Set([...doc.goodsReceipts, ...doc.freightReceipts].map(String))];
      await lock(ids.map((id) => ref('goodsReceipt', id)));

      const batchId = audit.newBatchId();
      const before = await audit.snap('purchaseInvoice', [doc]);
      for (const g of await GoodsReceipt.find({ _id: { $in: ids } })) {
        const grBefore = await audit.snap('goodsReceipt', [g]);
        if (String(g.purchaseInvoice) === String(doc._id)) g.purchaseInvoice = null;
        if (String(g.freightInvoice) === String(doc._id)) g.freightInvoice = null;
        await g.save();
        await audit.logUpdate(req, 'goodsReceipt', grBefore, [g], { batchId });
      }
      Object.assign(doc, { status: 'CANCELLED', paymentStatus: null, cancelReason: reason, cancelledBy: req.user._id, cancelledDate: new Date() });
      await doc.save();
      await audit.logUpdate(req, 'purchaseInvoice', before, [doc], { batchId });
      return doc;
    });
    return successResponse(res, doc, `${doc.no} cancelled`);
  } catch (error) {
    return handleError(res, error);
  }
};

exports.lineAmount = lineAmount;
exports.billBalance = billBalance;
