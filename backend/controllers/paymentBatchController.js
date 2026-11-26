const mongoose = require('mongoose');
const { successResponse, errorResponse } = require('../helpers/responseHelper');
const audit = require('../helpers/auditLogger');
const { runInTransaction, HttpError, lock, ref } = require('../helpers/transaction');
const { nextDocNo } = require('../helpers/stockHelper');
const { checkAmount, round2 } = require('../helpers/number');
const { invoiceBalance } = require('../helpers/salesHelper');
const { gudangScope, canAccessGudang } = require('../helpers/gudangAccess');
const { METHODS } = require('../helpers/paymentBatchSchema');

/**
 * Pembayaran gabungan (lihat helpers/paymentBatchSchema.js), dipakai 2x:
 *   /api/customer-receipt       : penerimaan dari customer untuk beberapa invoice penjualan (izin salesPayment)
 *   /api/vendor-payment-batch   : pembayaran ke vendor untuk beberapa tagihan (izin vendorPayment + vendorPrice:view)
 * Setiap alokasi = 1 dokumen pembayaran biasa (SalesPayment / VendorPayment) ber-`batch`, jadi status bayar,
 * umur piutang/hutang & laporan tidak berubah. Jumlah = total alokasi; batal = semua alokasi batal.
 */
const MAX_ALLOCATIONS = 200;
const SORTABLE_FIELDS = ['no', 'date', 'amount', 'createdDate'];

const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status);
  if (error.name === 'ValidationError' || error.name === 'CastError') return errorResponse(res, error.message, 400);
  return errorResponse(res, error.message, 500);
};
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const trimText = (v, max = 500) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));
const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

/**
 * cfg: { Batch, Payment, Invoice, Party, partyField, partyName (field nama), invoiceField, prefix, paymentPrefix,
 *        entity, paymentEntity, invoiceEntity, invoiceSelect, listKey,
 *        invoiceScope(req) -> filter tambahan invoice (akses gudang), canAccessInvoice(req, inv), paymentExtra(inv) }
 */
const makeBatchController = (cfg) => {
  const { Batch, Payment, Invoice, Party, partyField, partyName, invoiceField } = cfg;

  const applyToInvoice = (inv, delta) => {
    inv.paidAmount = round2((inv.paidAmount || 0) + delta);
    inv.paymentStatus = invoiceBalance(inv).paymentStatus;
  };

  /** GET / — filter search (no / referensi / catatan / nama), status, <party>, from, to; + allocationCount */
  const list = async (req, res) => {
    try {
      const page = Math.max(parseInt(req.query.page || 1) || 1, 1);
      const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || 10) || 10, 1), 100);
      const sortField = SORTABLE_FIELDS.includes(req.query.sortField) ? req.query.sortField : 'createdDate';
      const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
      const filter = {};
      if (['POSTED', 'CANCELLED'].includes(req.query.status)) filter.status = req.query.status;
      if (req.query[partyField]) {
        if (!mongoose.isValidObjectId(req.query[partyField])) return errorResponse(res, `Invalid ${partyField}`, 400);
        filter[partyField] = req.query[partyField];
      }
      if (req.query.from || req.query.to) {
        filter.date = {};
        if (req.query.from) filter.date.$gte = new Date(`${req.query.from}T00:00:00`);
        if (req.query.to) filter.date.$lte = new Date(`${req.query.to}T23:59:59.999`);
      }
      if (req.query.search) {
        const rx = { $regex: escapeRegex(req.query.search), $options: 'i' };
        const parties = await Party.find({ [partyName]: rx }).distinct('_id');
        filter.$or = [{ no: rx }, { reference: rx }, { note: rx }, { [partyField]: { $in: parties } }];
      }
      // akses gudang: hanya batch yang semua invoice-nya boleh diakses
      const scopeFilter = cfg.invoiceScope(req);
      if (scopeFilter) {
        const blocked = await Invoice.find({ $nor: [scopeFilter] }).distinct('_id');
        if (blocked.length) filter[`allocations.${invoiceField}`] = { $nin: blocked };
      }
      const [totalData, rows] = await Promise.all([
        Batch.countDocuments(filter),
        Batch.find(filter)
          .populate(partyField, partyName)
          .populate(`allocations.${invoiceField}`, 'no')
          .populate('createdBy', 'name')
          .populate('updatedBy', 'name')
          .sort({ [sortField]: sortOrder, _id: -1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .lean(),
      ]);
      rows.forEach((r) => { r.allocationCount = r.allocations.length; });
      return successResponse(res, { [cfg.listKey]: rows, totalData, currentPage: page, totalPages: Math.ceil(totalData / pageSize) });
    } catch (error) {
      return handleError(res, error);
    }
  };

  /** GET /open-invoices?<party>= — invoice / tagihan POSTED belum lunas, jatuh tempo tertua dulu (+ balance, overdue) */
  const openInvoices = async (req, res) => {
    try {
      const partyId = req.query[partyField];
      if (!mongoose.isValidObjectId(partyId)) return errorResponse(res, `Please select a ${partyField}`, 400);
      const filter = { [partyField]: partyId, status: 'POSTED', paymentStatus: { $in: ['UNPAID', 'PARTIAL'] } };
      const scopeFilter = cfg.invoiceScope(req);
      if (scopeFilter) Object.assign(filter, scopeFilter);
      const rows = await Invoice.find(filter).select(cfg.invoiceSelect).sort({ dueDate: 1, date: 1, no: 1 }).lean();
      const today = startOfDay(new Date());
      const data = rows.map((r) => {
        const { balance } = invoiceBalance(r);
        return { ...r, balance, overdue: !!r.dueDate && r.dueDate < today };
      }).filter((r) => r.balance > 0);
      return successResponse(res, data);
    } catch (error) {
      return handleError(res, error);
    }
  };

  const populateBatch = (q) => q
    .populate(partyField)
    .populate(`allocations.${invoiceField}`, cfg.invoiceSelect)
    .populate('allocations.payment', 'no status')
    .populate('createdBy', 'name')
    .populate('cancelledBy', 'name');

  /** GET /:id — lengkap (alokasi + invoice + pembayaran) */
  const get = async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 'Payment not found', 404);
      const doc = await populateBatch(Batch.findById(req.params.id)).lean();
      if (!doc) return errorResponse(res, 'Payment not found', 404);
      if (doc.allocations.some((a) => a[invoiceField] && !cfg.canAccessInvoice(req, a[invoiceField]))) {
        return errorResponse(res, "You don't have access to this warehouse", 403);
      }
      return successResponse(res, doc);
    } catch (error) {
      return handleError(res, error);
    }
  };

  /**
   * POST / — { <party>, date, method, amount, reference, note, allocations: [{ invoice, amount }] }
   * Jumlah harus = total alokasi; tiap alokasi <= sisa invoice. Invoice dikunci (bentrok dengan retur / batal).
   */
  const create = async (req, res) => {
    try {
      const body = req.body || {};
      const partyId = body[partyField];
      if (!mongoose.isValidObjectId(partyId)) return errorResponse(res, `Please select a ${partyField}`, 400);
      if (!METHODS.includes(body.method)) return errorResponse(res, 'Please select a payment method', 400);
      const amountErr = checkAmount(body.amount, 'Amount', { min: 0, exclusive: true });
      if (amountErr) return errorResponse(res, amountErr, 400);
      const amount = round2(body.amount);
      const date = body.date ? new Date(body.date) : new Date();
      if (Number.isNaN(date.getTime())) return errorResponse(res, 'Invalid payment date', 400);
      const endOfToday = new Date();
      endOfToday.setHours(23, 59, 59, 999);
      if (date > endOfToday) return errorResponse(res, 'Payment date cannot be in the future', 400);

      const input = (Array.isArray(body.allocations) ? body.allocations : []).filter((a) => Number(a?.amount) !== 0);
      if (!input.length) return errorResponse(res, 'Allocate the amount to at least one invoice', 400);
      if (input.length > MAX_ALLOCATIONS) return errorResponse(res, `At most ${MAX_ALLOCATIONS} invoices per payment`, 400);
      const seen = new Set();
      const allocations = [];
      for (const [i, a] of input.entries()) {
        if (!mongoose.isValidObjectId(a?.invoice)) return errorResponse(res, `Line ${i + 1}: invalid invoice`, 400);
        if (seen.has(String(a.invoice))) return errorResponse(res, `Line ${i + 1}: the same invoice appears more than once`, 400);
        seen.add(String(a.invoice));
        const err = checkAmount(a.amount, 'Allocated amount', { min: 0, exclusive: true });
        if (err) return errorResponse(res, `Line ${i + 1}: ${err}`, 400);
        allocations.push({ invoice: String(a.invoice), amount: round2(a.amount) });
      }
      const allocated = round2(allocations.reduce((s, a) => s + a.amount, 0));
      if (allocated !== amount) {
        return errorResponse(res, `Allocated ${fmt(allocated)} must equal the amount ${fmt(amount)} (overpayments are not supported yet)`, 400);
      }

      const doc = await runInTransaction(async () => {
        await lock(ref(partyField, partyId), allocations.map((a) => ref(cfg.invoiceEntity, a.invoice)));
        const party = await Party.findById(partyId).select(partyName).lean();
        if (!party) throw new HttpError(`${partyField} not found`, 404);
        const invoices = await Invoice.find({ _id: { $in: allocations.map((a) => a.invoice) } });
        if (invoices.length !== allocations.length) throw new HttpError('One or more invoices no longer exist', 400);
        const byId = new Map(invoices.map((inv) => [String(inv._id), inv]));

        const batch = new Batch({
          no: await nextDocNo(cfg.prefix),
          [partyField]: partyId,
          date,
          method: body.method,
          amount,
          reference: trimText(body.reference, 100),
          note: trimText(body.note),
          createdBy: req.user._id,
        });
        const batchId = audit.newBatchId();
        const payments = [];
        for (const a of allocations) {
          const inv = byId.get(a.invoice);
          if (!cfg.canAccessInvoice(req, inv)) throw new HttpError("You don't have access to this warehouse", 403);
          if (inv.status !== 'POSTED') throw new HttpError(`${inv.no} is not posted`, 400);
          if (String(inv[partyField]) !== String(partyId)) throw new HttpError(`${inv.no} does not belong to ${party[partyName]}`, 400);
          const { balance } = invoiceBalance(inv);
          if (a.amount > balance) throw new HttpError(`${inv.no}: ${fmt(a.amount)} exceeds the outstanding balance ${fmt(balance)}`, 400);
          const payment = await Payment.create({
            no: await nextDocNo(cfg.paymentPrefix),
            type: 'PAYMENT',
            [invoiceField]: inv._id,
            [partyField]: partyId,
            ...cfg.paymentExtra(inv),
            batch: batch._id,
            date,
            method: body.method,
            amount: a.amount,
            reference: batch.reference,
            note: trimText([batch.no, batch.note].filter(Boolean).join(' · ')),
            createdBy: req.user._id,
          });
          payments.push(payment);
          const before = await audit.snap(cfg.invoiceEntity, [inv]);
          applyToInvoice(inv, a.amount);
          await inv.save();
          await audit.logUpdate(req, cfg.invoiceEntity, before, [inv], { batchId });
          batch.allocations.push({ [invoiceField]: inv._id, payment: payment._id, amount: a.amount });
        }
        await batch.save();
        await audit.logCreate(req, cfg.entity, [batch], { batchId });
        await audit.logCreate(req, cfg.paymentEntity, payments, { batchId });
        return batch;
      });
      return successResponse(res, doc, `${doc.no} recorded for ${doc.allocations.length} invoice(s)`, 201);
    } catch (error) {
      return handleError(res, error);
    }
  };

  /** POST /:id/cancel { reason } — semua pembayaran alokasinya dibatalkan, sisa invoice kembali */
  const cancel = async (req, res) => {
    try {
      const reason = trimText(req.body?.reason);
      if (!reason) return errorResponse(res, 'Cancellation reason is required', 400);
      if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 'Payment not found', 404);
      const doc = await runInTransaction(async () => {
        const doc = await Batch.findById(req.params.id);
        if (!doc) throw new HttpError('Payment not found', 404);
        if (doc.status !== 'POSTED') throw new HttpError(`${doc.no} is already cancelled`, 400);
        const invIds = doc.allocations.map((a) => String(a[invoiceField]));
        await lock(ref(cfg.entity, doc._id), invIds.map((id) => ref(cfg.invoiceEntity, id)));
        const invoices = await Invoice.find({ _id: { $in: invIds } });
        if (invoices.some((inv) => !cfg.canAccessInvoice(req, inv))) throw new HttpError("You don't have access to this warehouse", 403);
        const byId = new Map(invoices.map((inv) => [String(inv._id), inv]));
        const batchId = audit.newBatchId();
        const before = await audit.snap(cfg.entity, [doc]);
        for (const a of doc.allocations) {
          const payment = await Payment.findById(a.payment);
          if (!payment || payment.status !== 'POSTED') continue;
          const pBefore = await audit.snap(cfg.paymentEntity, [payment]);
          Object.assign(payment, { status: 'CANCELLED', cancelReason: reason, cancelledBy: req.user._id, cancelledDate: new Date() });
          await payment.save();
          await audit.logUpdate(req, cfg.paymentEntity, pBefore, [payment], { batchId });
          const inv = byId.get(String(a[invoiceField]));
          if (inv && inv.status === 'POSTED') {
            const iBefore = await audit.snap(cfg.invoiceEntity, [inv]);
            applyToInvoice(inv, -payment.amount);
            await inv.save();
            await audit.logUpdate(req, cfg.invoiceEntity, iBefore, [inv], { batchId });
          }
        }
        Object.assign(doc, { status: 'CANCELLED', cancelReason: reason, cancelledBy: req.user._id, cancelledDate: new Date() });
        await doc.save();
        await audit.logUpdate(req, cfg.entity, before, [doc], { batchId });
        return doc;
      });
      return successResponse(res, doc, `${doc.no} cancelled`);
    } catch (error) {
      return handleError(res, error);
    }
  };

  return { list, openInvoices, get, create, cancel };
};

// ---------------------------------------------------------------- konfigurasi

const gudangOf = (inv) => inv.gudang?._id ?? inv.gudang;

exports.customerReceipt = makeBatchController({
  Batch: require('../models/CustomerReceipt'),
  Payment: require('../models/SalesPayment'),
  Invoice: require('../models/SalesInvoice'),
  Party: require('../models/Customer'),
  partyField: 'customer',
  partyName: 'name',
  invoiceField: 'salesInvoice',
  prefix: 'RCV',
  paymentPrefix: 'PAY',
  entity: 'customerReceipt',
  paymentEntity: 'salesPayment',
  invoiceEntity: 'salesInvoice',
  invoiceSelect: 'no date dueDate total returnedAmount paidAmount paymentStatus gudang customer',
  listKey: 'dataCustomerReceipt',
  invoiceScope: (req) => {
    const scope = gudangScope(req);
    return scope ? { gudang: { $in: scope } } : null;
  },
  canAccessInvoice: (req, inv) => canAccessGudang(req, gudangOf(inv)),
  paymentExtra: (inv) => ({ gudang: inv.gudang }),
});

exports.vendorPaymentBatch = makeBatchController({
  Batch: require('../models/VendorPaymentBatch'),
  Payment: require('../models/VendorPayment'),
  Invoice: require('../models/PurchaseInvoice'),
  Party: require('../models/Vendor'),
  partyField: 'vendor',
  partyName: 'companyName',
  invoiceField: 'purchaseInvoice',
  prefix: 'VPB',
  paymentPrefix: 'VPAY',
  entity: 'vendorPaymentBatch',
  paymentEntity: 'vendorPayment',
  invoiceEntity: 'purchaseInvoice',
  invoiceSelect: 'no vendorInvoiceNo date dueDate total returnedAmount paidAmount paymentStatus gudangs vendor',
  listKey: 'dataVendorPaymentBatch',
  invoiceScope: (req) => {
    const scope = gudangScope(req);
    return scope ? { gudangs: { $in: scope.map((id) => new mongoose.Types.ObjectId(id)) } } : null;
  },
  canAccessInvoice: (req, inv) => {
    const scope = gudangScope(req);
    return !scope || (inv.gudangs || []).some((g) => scope.includes(String(g?._id ?? g)));
  },
  paymentExtra: () => ({}),
});
