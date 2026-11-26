const mongoose = require('mongoose');
const VendorPayment = require('../models/VendorPayment');
const PurchaseInvoice = require('../models/PurchaseInvoice');
const Vendor = require('../models/Vendor');
const { successResponse, errorResponse } = require('../helpers/responseHelper');
const audit = require('../helpers/auditLogger');
const { runInTransaction, HttpError, lock, ref } = require('../helpers/transaction');
const { nextDocNo } = require('../helpers/stockHelper');
const { checkAmount, round2 } = require('../helpers/number');
const { invoiceBalance } = require('../helpers/salesHelper');
const { gudangScope } = require('../helpers/gudangAccess');

/**
 * Pembayaran vendor (lihat models/VendorPayment.js). Izin vendorPayment: view, create (catat), update (batalkan)
 * + vendorPrice:view (di route).
 */
const TYPES = ['PAYMENT', 'REFUND'];
const METHODS = ['CASH', 'TRANSFER', 'OTHER'];
const SORTABLE_FIELDS = ['no', 'date', 'amount', 'createdDate'];

const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status);
  if (error.name === 'ValidationError' || error.name === 'CastError') return errorResponse(res, error.message, 400);
  return errorResponse(res, error.message, 500);
};
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const trimText = (v, max = 500) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));
const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

/** Tagihan yang boleh diakses (akses gudang lewat gudang GR-nya) */
const loadBill = async (req, id) => {
  const filter = { _id: id };
  const scope = gudangScope(req);
  if (scope) filter.gudangs = { $in: scope };
  const bill = await PurchaseInvoice.findOne(filter);
  if (!bill) throw new HttpError('Vendor bill not found', 404);
  return bill;
};

const applyToBill = (bill, delta) => {
  bill.paidAmount = round2((bill.paidAmount || 0) + delta);
  bill.paymentStatus = invoiceBalance(bill).paymentStatus;
};

/** GET /api/vendor-payment — filter search (no / referensi / catatan / tagihan / vendor), status, type, method, vendor, purchaseInvoice, from, to; + totalNet */
exports.getPayments = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || 1) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || 10) || 10, 1), 100);
    const sortField = SORTABLE_FIELDS.includes(req.query.sortField) ? req.query.sortField : 'createdDate';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const filter = {};
    const scope = gudangScope(req);
    if (scope) filter.purchaseInvoice = { $in: await PurchaseInvoice.find({ gudangs: { $in: scope } }).distinct('_id') };
    if (req.query.search) {
      const rx = { $regex: escapeRegex(req.query.search), $options: 'i' };
      const [vendors, bills] = await Promise.all([
        Vendor.find({ companyName: rx }).distinct('_id'),
        PurchaseInvoice.find({ $or: [{ no: rx }, { vendorInvoiceNo: rx }] }).distinct('_id'),
      ]);
      filter.$or = [{ no: rx }, { reference: rx }, { note: rx }, { vendor: { $in: vendors } }, { purchaseInvoice: { $in: bills } }];
    }
    if (['POSTED', 'CANCELLED'].includes(req.query.status)) filter.status = req.query.status;
    if (TYPES.includes(req.query.type)) filter.type = req.query.type;
    if (METHODS.includes(req.query.method)) filter.method = req.query.method;
    for (const key of ['vendor', 'purchaseInvoice']) {
      if (!req.query[key]) continue;
      if (!mongoose.isValidObjectId(req.query[key])) return errorResponse(res, `Invalid ${key}`, 400);
      if (key === 'purchaseInvoice' && filter.purchaseInvoice) filter.$and = [{ purchaseInvoice: filter.purchaseInvoice }, { purchaseInvoice: req.query[key] }];
      else filter[key] = req.query[key];
    }
    if (filter.$and) delete filter.purchaseInvoice;
    if (req.query.from || req.query.to) {
      filter.date = {};
      if (req.query.from) filter.date.$gte = new Date(`${req.query.from}T00:00:00`);
      if (req.query.to) filter.date.$lte = new Date(`${req.query.to}T23:59:59.999`);
    }
    const [totalData, docs, sum] = await Promise.all([
      VendorPayment.countDocuments(filter),
      VendorPayment.find(filter)
        .populate('purchaseInvoice', 'no vendorInvoiceNo')
        .populate('vendor', 'companyName')
        .populate('createdBy', 'name')
        .populate('updatedBy', 'name')
        .sort({ [sortField]: sortOrder, _id: sortOrder })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      VendorPayment.aggregate([
        { $match: VendorPayment.where({ ...filter, status: 'POSTED', ...(filter.status === 'CANCELLED' ? { _id: null } : {}) }).cast(VendorPayment) },
        { $group: { _id: null, net: { $sum: { $cond: [{ $eq: ['$type', 'REFUND'] }, { $multiply: ['$amount', -1] }, '$amount'] } } } },
      ]),
    ]);
    return successResponse(res, { dataVendorPayment: docs, totalNet: round2(sum[0]?.net || 0), totalData, currentPage: page, totalPages: Math.ceil(totalData / pageSize) });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * POST /api/vendor-payment  body: { purchaseInvoice, type (PAYMENT|REFUND), date, method, amount, reference, note }
 * PAYMENT <= sisa hutang; REFUND (uang kembali dari vendor) <= kelebihan bayar.
 */
exports.createPayment = async (req, res) => {
  try {
    const { purchaseInvoice } = req.body;
    if (!mongoose.isValidObjectId(purchaseInvoice)) return errorResponse(res, 'Please select a vendor bill', 400);
    const type = req.body.type === 'REFUND' ? 'REFUND' : 'PAYMENT';
    if (!METHODS.includes(req.body.method)) return errorResponse(res, 'Please select a payment method', 400);
    const amountErr = checkAmount(req.body.amount, 'Amount', { min: 0, exclusive: true });
    if (amountErr) return errorResponse(res, amountErr, 400);
    const amount = round2(req.body.amount);
    const date = req.body.date ? new Date(req.body.date) : new Date();
    if (Number.isNaN(date.getTime())) return errorResponse(res, 'Invalid payment date', 400);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    if (date > endOfToday) return errorResponse(res, 'Payment date cannot be in the future', 400);

    const doc = await runInTransaction(async () => {
      await lock(ref('purchaseInvoice', purchaseInvoice));
      const bill = await loadBill(req, purchaseInvoice);
      if (bill.status !== 'POSTED') throw new HttpError('Payments can only be recorded for posted vendor bills', 400);
      const { balance } = invoiceBalance(bill);
      if (type === 'PAYMENT') {
        if (balance <= 0) throw new HttpError(`${bill.no} has nothing left to pay`, 400);
        if (amount > balance) throw new HttpError(`Amount ${fmt(amount)} exceeds the outstanding balance ${fmt(balance)}`, 400);
      } else {
        if (balance >= 0) throw new HttpError(`${bill.no} is not overpaid; nothing to refund`, 400);
        if (amount > -balance) throw new HttpError(`Refund ${fmt(amount)} exceeds the overpaid amount ${fmt(-balance)}`, 400);
      }
      const doc = await VendorPayment.create({
        no: await nextDocNo(type === 'REFUND' ? 'VRF' : 'VPAY'),
        type,
        purchaseInvoice: bill._id,
        vendor: bill.vendor,
        date,
        method: req.body.method,
        amount,
        reference: trimText(req.body.reference, 100),
        note: trimText(req.body.note),
        createdBy: req.user._id,
      });
      const before = await audit.snap('purchaseInvoice', [bill]);
      applyToBill(bill, type === 'REFUND' ? -amount : amount);
      await bill.save();
      const batchId = audit.newBatchId();
      await audit.logCreate(req, 'vendorPayment', [doc], { batchId });
      await audit.logUpdate(req, 'purchaseInvoice', before, [bill], { batchId });
      return doc;
    });
    return successResponse(res, doc, `${doc.no} recorded`, 201);
  } catch (error) {
    return handleError(res, error);
  }
};

/** POST /api/vendor-payment/:id/cancel { reason } */
exports.cancelPayment = async (req, res) => {
  try {
    const reason = trimText(req.body?.reason);
    if (!reason) return errorResponse(res, 'Cancellation reason is required', 400);
    if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 'Payment not found', 404);
    const doc = await runInTransaction(async () => {
      const doc = await VendorPayment.findById(req.params.id);
      if (!doc) throw new HttpError('Payment not found', 404);
      if (doc.status !== 'POSTED') throw new HttpError('Payment is already cancelled', 400);
      await lock(ref('purchaseInvoice', doc.purchaseInvoice));
      const bill = await loadBill(req, doc.purchaseInvoice);
      const before = await audit.snap('vendorPayment', [doc]);
      const billBefore = await audit.snap('purchaseInvoice', [bill]);
      if (bill.status === 'POSTED') applyToBill(bill, doc.type === 'REFUND' ? doc.amount : -doc.amount);
      await bill.save();
      Object.assign(doc, { status: 'CANCELLED', cancelReason: reason, cancelledBy: req.user._id, cancelledDate: new Date() });
      await doc.save();
      const batchId = audit.newBatchId();
      await audit.logUpdate(req, 'vendorPayment', before, [doc], { batchId });
      await audit.logUpdate(req, 'purchaseInvoice', billBefore, [bill], { batchId });
      return doc;
    });
    return successResponse(res, doc, `${doc.no} cancelled`);
  } catch (error) {
    return handleError(res, error);
  }
};
