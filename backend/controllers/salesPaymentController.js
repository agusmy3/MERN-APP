const mongoose = require('mongoose');
const SalesPayment = require('../models/SalesPayment');
const SalesInvoice = require('../models/SalesInvoice');
const Customer = require('../models/Customer');
const { successResponse, errorResponse } = require('../helpers/responseHelper');
const audit = require('../helpers/auditLogger');
const { runInTransaction, HttpError, lock, ref } = require('../helpers/transaction');
const { nextDocNo } = require('../helpers/stockHelper');
const { checkAmount, round2 } = require('../helpers/number');
const { invoiceBalance } = require('../helpers/salesHelper');
const { assertGudang, applyGudangFilter } = require('../helpers/gudangAccess');

const TYPES = ['PAYMENT', 'REFUND'];
const METHODS = ['CASH', 'CARD', 'QRIS', 'TRANSFER', 'OTHER'];
const SORTABLE_FIELDS = ['no', 'date', 'amount', 'createdDate'];

const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status);
  if (error.name === 'ValidationError' || error.name === 'CastError') return errorResponse(res, error.message, 400);
  return errorResponse(res, error.message, 500);
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const trimText = (v, max = 500) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));
const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

/** Terapkan perubahan paidAmount ke invoice + status bayar (di dalam transaksi) */
const applyToInvoice = (inv, delta) => {
  inv.paidAmount = round2((inv.paidAmount || 0) + delta);
  inv.paymentStatus = invoiceBalance(inv).paymentStatus;
};

/**
 * GET /api/sales-payment — filter search (no / referensi / catatan / invoice / customer), status, type,
 * method, customer, salesInvoice, gudang, from, to
 */
exports.getPayments = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || 1) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || 10) || 10, 1), 100);
    const sortField = SORTABLE_FIELDS.includes(req.query.sortField) ? req.query.sortField : 'createdDate';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const filter = {};
    if (req.query.search) {
      const rx = { $regex: escapeRegex(req.query.search), $options: 'i' };
      const [customers, invoices] = await Promise.all([
        Customer.find({ $or: [{ name: rx }, { code: rx }] }).distinct('_id'),
        SalesInvoice.find({ no: rx }).distinct('_id'),
      ]);
      filter.$or = [{ no: rx }, { reference: rx }, { note: rx }, { customer: { $in: customers } }, { salesInvoice: { $in: invoices } }];
    }
    if (['POSTED', 'CANCELLED'].includes(req.query.status)) filter.status = req.query.status;
    if (TYPES.includes(req.query.type)) filter.type = req.query.type;
    if (METHODS.includes(req.query.method)) filter.method = req.query.method;
    for (const key of ['customer', 'salesInvoice']) {
      if (!req.query[key]) continue;
      if (!mongoose.isValidObjectId(req.query[key])) return errorResponse(res, `Invalid ${key}`, 400);
      filter[key] = req.query[key];
    }
    if (req.query.gudang && !mongoose.isValidObjectId(req.query.gudang)) return errorResponse(res, 'Invalid warehouse', 400);
    applyGudangFilter(req, filter, req.query.gudang);
    if (req.query.from || req.query.to) {
      const date = {};
      if (req.query.from) date.$gte = new Date(`${req.query.from}T00:00:00`);
      if (req.query.to) date.$lte = new Date(`${req.query.to}T23:59:59.999`);
      if (Object.values(date).some((d) => Number.isNaN(d.getTime()))) return errorResponse(res, 'Invalid date', 400);
      filter.date = date;
    }
    const [totalData, docs, sum] = await Promise.all([
      SalesPayment.countDocuments(filter),
      SalesPayment.find(filter)
        .populate('salesInvoice', 'no')
        .populate('batch', 'no')
        .populate('customer', 'code name')
        .populate('gudang', 'code')
        .populate('createdBy', 'name')
        .populate('updatedBy', 'name')
        .sort({ [sortField]: sortOrder, _id: sortOrder })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      // total bersih (pembayaran - refund) yang masih berlaku, sesuai filter
      SalesPayment.aggregate([
        // aggregate tidak meng-cast id string -> cast lewat query mongoose
        { $match: SalesPayment.where({ ...filter, status: 'POSTED', ...(filter.status === 'CANCELLED' ? { _id: null } : {}) }).cast(SalesPayment) },
        { $group: { _id: null, net: { $sum: { $cond: [{ $eq: ['$type', 'REFUND'] }, { $multiply: ['$amount', -1] }, '$amount'] } } } },
      ]),
    ]);
    return successResponse(res, {
      dataSalesPayment: docs,
      totalNet: round2(sum[0]?.net || 0),
      totalData,
      currentPage: page,
      totalPages: Math.ceil(totalData / pageSize),
    });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * POST /api/sales-payment  body: { salesInvoice, type (PAYMENT|REFUND), date, method, amount, reference, note }
 * PAYMENT <= sisa tagihan; REFUND <= kelebihan bayar. Invoice dikunci (bentrok dengan retur / pembatalan).
 */
exports.createPayment = async (req, res) => {
  try {
    const { salesInvoice } = req.body;
    if (!mongoose.isValidObjectId(salesInvoice)) return errorResponse(res, 'Please select a sales invoice', 400);
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
      await lock(ref('salesInvoice', salesInvoice));
      const inv = await SalesInvoice.findById(salesInvoice);
      if (!inv) throw new HttpError('Sales invoice not found', 404);
      assertGudang(req, inv.gudang);
      if (inv.status !== 'POSTED') throw new HttpError('Payments can only be recorded for posted invoices', 400);
      const { balance } = invoiceBalance(inv);
      if (type === 'PAYMENT') {
        if (balance <= 0) throw new HttpError(`${inv.no} has nothing left to pay`, 400);
        if (amount > balance) throw new HttpError(`Amount ${fmt(amount)} exceeds the outstanding balance ${fmt(balance)}`, 400);
      } else {
        if (balance >= 0) throw new HttpError(`${inv.no} is not overpaid; nothing to refund`, 400);
        if (amount > -balance) throw new HttpError(`Refund ${fmt(amount)} exceeds the overpaid amount ${fmt(-balance)}`, 400);
      }

      const doc = await SalesPayment.create({
        no: await nextDocNo(type === 'REFUND' ? 'RFD' : 'PAY'),
        type,
        salesInvoice: inv._id,
        customer: inv.customer,
        gudang: inv.gudang,
        date,
        method: req.body.method,
        amount,
        reference: trimText(req.body.reference, 100),
        note: trimText(req.body.note),
        createdBy: req.user._id,
      });
      const invBefore = await audit.snap('salesInvoice', [inv]);
      applyToInvoice(inv, type === 'REFUND' ? -amount : amount);
      await inv.save();
      await audit.logCreate(req, 'salesPayment', [doc]);
      await audit.logUpdate(req, 'salesInvoice', invBefore, [inv]);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} recorded`, 201);
  } catch (error) {
    return handleError(res, error);
  }
};

/** POST /api/sales-payment/:id/cancel { reason } — batalkan pembayaran / refund, tagihan invoice dihitung ulang */
exports.cancelPayment = async (req, res) => {
  try {
    const cancelReason = trimText(req.body.reason);
    if (!cancelReason) return errorResponse(res, 'Cancellation reason is required', 400);
    if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 'Payment not found', 404);
    const doc = await runInTransaction(async () => {
      const doc = await SalesPayment.findById(req.params.id);
      if (!doc) throw new HttpError('Payment not found', 404);
      assertGudang(req, doc.gudang);
      if (doc.status !== 'POSTED') throw new HttpError('Payment is already cancelled', 400);
      if (doc.batch) {
        const batch = await mongoose.model('CustomerReceipt').findById(doc.batch).select('no').lean();
        throw new HttpError(`${doc.no} is part of combined payment ${batch?.no || ''}. Cancel that payment instead.`, 400);
      }
      if (doc.shift) {
        const shift = await require('../models/PosShift').findById(doc.shift).select('status no').lean();
        if (shift?.status === 'CLOSED') throw new HttpError(`Payment belongs to POS shift ${shift.no}, which is already closed`, 400);
      }
      await lock(ref('salesInvoice', doc.salesInvoice));
      const inv = await SalesInvoice.findById(doc.salesInvoice);
      if (!inv) throw new HttpError('Sales invoice no longer exists', 400);

      const before = await audit.snap('salesPayment', [doc]);
      const invBefore = await audit.snap('salesInvoice', [inv]);
      applyToInvoice(inv, doc.type === 'REFUND' ? doc.amount : -doc.amount);
      await inv.save();
      doc.status = 'CANCELLED';
      doc.cancelledBy = req.user._id;
      doc.cancelledDate = new Date();
      doc.cancelReason = cancelReason;
      await doc.save();
      await audit.logUpdate(req, 'salesPayment', before, [doc]);
      await audit.logUpdate(req, 'salesInvoice', invBefore, [inv]);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} cancelled`);
  } catch (error) {
    return handleError(res, error);
  }
};
