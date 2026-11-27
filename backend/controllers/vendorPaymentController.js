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
const { parsePaymentInput, assertWriteOffAllowed, applyToInvoice, recordPayment, reversePayment } = require('../helpers/paymentHelper');

const SIDE = 'purchase';

/**
 * Pembayaran vendor (lihat models/VendorPayment.js). Izin vendorPayment: view, create (catat), update (batalkan)
 * + vendorPrice:view (di route).
 */
const TYPES = ['PAYMENT', 'REFUND'];
const METHODS = ['CASH', 'TRANSFER', 'OTHER'];
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

/** Tagihan yang boleh diakses (akses gudang lewat gudang GR-nya) */
const loadBill = async (req, id) => {
  const filter = { _id: id };
  const scope = gudangScope(req);
  if (scope) filter.gudangs = { $in: scope };
  const bill = await PurchaseInvoice.findOne(filter);
  if (!bill) throw new HttpError('Vendor bill not found', 404);
  return bill;
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
    if (FILTER_METHODS.includes(req.query.method)) filter.method = req.query.method;
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
        .populate('batch', 'no')
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
 * POST /api/vendor-payment  body: { purchaseInvoice, type (PAYMENT|REFUND), date, method (+ DEPOSIT & deposit untuk PAYMENT),
 *   amount, writeOffAmount, writeOffReason, reference, note }
 * PAYMENT: uang + potongan dari vendor <= sisa hutang (potongan > setting butuh vendorPayment:approve);
 * REFUND (uang kembali dari vendor) <= kelebihan bayar (memindah ke uang muka: POST /api/vendor-deposit/from-invoice).
 */
exports.createPayment = async (req, res) => {
  try {
    const { purchaseInvoice } = req.body;
    if (!mongoose.isValidObjectId(purchaseInvoice)) return errorResponse(res, 'Please select a vendor bill', 400);
    const p = parsePaymentBody(req.body);
    if (p.error) return errorResponse(res, p.error, 400);

    const doc = await runInTransaction(async () => {
      await lock(ref('purchaseInvoice', purchaseInvoice));
      const bill = await loadBill(req, purchaseInvoice);
      if (bill.status !== 'POSTED') throw new HttpError('Payments can only be recorded for posted vendor bills', 400);
      const batchId = audit.newBatchId();
      if (p.type === 'PAYMENT') {
        await assertWriteOffAllowed(req, SIDE, p.writeOff.writeOffAmount, p.writeOff.writeOffReason);
        const { payment } = await recordPayment(req, SIDE, bill, {
          date: p.date, method: p.method, amount: p.amount, ...p.writeOff, depositId: req.body.deposit,
          reference: trimText(req.body.reference, 100), note: p.note, batchId,
        });
        return payment;
      }
      const { balance } = invoiceBalance(bill);
      if (balance >= 0) throw new HttpError(`${bill.no} is not overpaid; nothing to refund`, 400);
      if (p.amount > -balance) throw new HttpError(`Refund ${fmt(p.amount)} exceeds the overpaid amount ${fmt(-balance)}`, 400);
      const doc = await VendorPayment.create({
        no: await nextDocNo('VRF'),
        type: 'REFUND',
        purchaseInvoice: bill._id,
        vendor: bill.vendor,
        date: p.date,
        method: p.method,
        amount: p.amount,
        reference: trimText(req.body.reference, 100),
        note: p.note,
        createdBy: req.user._id,
      });
      const before = await audit.snap('purchaseInvoice', [bill]);
      applyToInvoice(bill, -p.amount);
      await bill.save();
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
      if (doc.batch) {
        const batch = await mongoose.model('VendorPaymentBatch').findById(doc.batch).select('no').lean();
        throw new HttpError(`${doc.no} is part of combined payment ${batch?.no || ''}. Cancel that payment instead.`, 400);
      }
      if (doc.type === 'REFUND' && doc.method === 'DEPOSIT') {
        const dep = await mongoose.model('VendorDeposit').findById(doc.deposit).select('no').lean();
        throw new HttpError(`${doc.no} moved the overpayment to vendor deposit ${dep?.no || ''}. Cancel that deposit instead.`, 400);
      }
      await loadBill(req, doc.purchaseInvoice); // akses gudang
      return reversePayment(req, SIDE, doc, reason, { batchId: audit.newBatchId() });
    });
    return successResponse(res, doc, `${doc.no} cancelled`);
  } catch (error) {
    return handleError(res, error);
  }
};
