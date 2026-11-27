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
const { parsePaymentInput, assertWriteOffAllowed, applyToInvoice, recordPayment, reversePayment } = require('../helpers/paymentHelper');

const SIDE = 'sales';

const TYPES = ['PAYMENT', 'REFUND'];
const METHODS = ['CASH', 'CARD', 'QRIS', 'TRANSFER', 'OTHER'];
const FILTER_METHODS = [...METHODS, 'DEPOSIT'];
const parsePaymentBody = (body) => parsePaymentInput(SIDE, body, METHODS);
const SORTABLE_FIELDS = ['no', 'date', 'amount', 'createdDate'];

const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status);
  if (error.name === 'ValidationError' || error.name === 'CastError') return errorResponse(res, error.message, 400);
  return errorResponse(res, error.message, 500);
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const trimText = (v, max = 500) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));
const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });


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
    if (FILTER_METHODS.includes(req.query.method)) filter.method = req.query.method;
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
 * POST /api/sales-payment  body: { salesInvoice, type (PAYMENT|REFUND), date, method (+ DEPOSIT & deposit untuk PAYMENT),
 *   amount, writeOffAmount, writeOffReason, reference, note }
 * PAYMENT: uang + potongan <= sisa tagihan (potongan > setting / piutang tak tertagih butuh salesPayment:approve);
 * REFUND <= kelebihan bayar (memindah kelebihan ke deposit: POST /api/customer-deposit/from-invoice).
 */
exports.createPayment = async (req, res) => {
  try {
    const { salesInvoice } = req.body;
    if (!mongoose.isValidObjectId(salesInvoice)) return errorResponse(res, 'Please select a sales invoice', 400);
    const p = parsePaymentBody(req.body);
    if (p.error) return errorResponse(res, p.error, 400);

    const doc = await runInTransaction(async () => {
      await lock(ref('salesInvoice', salesInvoice));
      const inv = await SalesInvoice.findById(salesInvoice);
      if (!inv) throw new HttpError('Sales invoice not found', 404);
      assertGudang(req, inv.gudang);
      if (inv.status !== 'POSTED') throw new HttpError('Payments can only be recorded for posted invoices', 400);
      const batchId = audit.newBatchId();
      if (p.type === 'PAYMENT') {
        await assertWriteOffAllowed(req, SIDE, p.writeOff.writeOffAmount, p.writeOff.writeOffReason);
        const { payment } = await recordPayment(req, SIDE, inv, {
          date: p.date, method: p.method, amount: p.amount, ...p.writeOff, depositId: req.body.deposit,
          reference: trimText(req.body.reference, 100), note: p.note, extra: { gudang: inv.gudang }, batchId,
        });
        return payment;
      }
      const { balance } = invoiceBalance(inv);
      if (balance >= 0) throw new HttpError(`${inv.no} is not overpaid; nothing to refund`, 400);
      if (p.amount > -balance) throw new HttpError(`Refund ${fmt(p.amount)} exceeds the overpaid amount ${fmt(-balance)}`, 400);
      const doc = await SalesPayment.create({
        no: await nextDocNo('RFD'),
        type: 'REFUND',
        salesInvoice: inv._id,
        customer: inv.customer,
        gudang: inv.gudang,
        date: p.date,
        method: p.method,
        amount: p.amount,
        reference: trimText(req.body.reference, 100),
        note: p.note,
        createdBy: req.user._id,
      });
      const invBefore = await audit.snap('salesInvoice', [inv]);
      applyToInvoice(inv, -p.amount);
      await inv.save();
      await audit.logCreate(req, 'salesPayment', [doc], { batchId });
      await audit.logUpdate(req, 'salesInvoice', invBefore, [inv], { batchId });
      return doc;
    });
    return successResponse(res, doc, `${doc.no} recorded`, 201);
  } catch (error) {
    return handleError(res, error);
  }
};

/** POST /api/sales-payment/:id/cancel { reason } — batalkan pembayaran / refund, tagihan invoice (& saldo deposit) dihitung ulang */
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
      if (doc.type === 'REFUND' && doc.method === 'DEPOSIT') {
        const dep = await mongoose.model('CustomerDeposit').findById(doc.deposit).select('no').lean();
        throw new HttpError(`${doc.no} moved the overpayment to deposit ${dep?.no || ''}. Cancel that deposit instead.`, 400);
      }
      if (doc.shift) {
        const shift = await require('../models/PosShift').findById(doc.shift).select('status no').lean();
        if (shift?.status === 'CLOSED') throw new HttpError(`Payment belongs to POS shift ${shift.no}, which is already closed`, 400);
      }
      return reversePayment(req, SIDE, doc, cancelReason, { batchId: audit.newBatchId() });
    });
    return successResponse(res, doc, `${doc.no} cancelled`);
  } catch (error) {
    return handleError(res, error);
  }
};
