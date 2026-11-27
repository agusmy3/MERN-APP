const mongoose = require('mongoose');
const { successResponse, errorResponse } = require('../helpers/responseHelper');
const audit = require('../helpers/auditLogger');
const { runInTransaction, HttpError, lock, ref } = require('../helpers/transaction');
const { nextDocNo } = require('../helpers/stockHelper');
const { checkAmount, round2 } = require('../helpers/number');
const { invoiceBalance } = require('../helpers/salesHelper');
const { gudangScope, canAccessGudang } = require('../helpers/gudangAccess');
const { METHODS } = require('../helpers/paymentBatchSchema');
const { SIDES, parseWriteOff, assertWriteOffAllowed, recordPayment, reversePayment } = require('../helpers/paymentHelper');
const { getSettings } = require('../helpers/settings');

/**
 * Pembayaran gabungan (lihat helpers/paymentBatchSchema.js), dipakai 2x:
 *   /api/customer-receipt       : penerimaan dari customer untuk beberapa invoice penjualan (izin salesPayment)
 *   /api/vendor-payment-batch   : pembayaran ke vendor untuk beberapa tagihan (izin vendorPayment + vendorPrice:view)
 * Setiap alokasi = 1+ dokumen pembayaran biasa (SalesPayment / VendorPayment) ber-`batch` (dari deposit lalu dari uang
 * baru, + potongan), jadi status bayar, umur piutang/hutang & laporan tidak berubah. Kelebihan uang -> deposit baru;
 * batal = semua pembayaran alokasi batal, deposit yang dipakai kembali, deposit dari kelebihan ikut batal.
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

  const s = SIDES[cfg.side];

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
    .populate('allocations.payments', 'no status method amount writeOffAmount')
    .populate('deposits.deposit', 'no')
    .populate('depositCreated', 'no status')
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
   * POST / — { <party>, date, method, amount, reference, note, deposits: [{ deposit, amount }],
   *            allocations: [{ invoice, amount, writeOff, writeOffReason }] }
   * Dana = uang baru (amount) + deposit yang dipakai. Tiap invoice: uang + potongan <= sisa. Alokasi dibayar dari deposit
   * dulu (urutan input), lalu uang baru. Total alokasi <= dana; deposit yang dipakai harus habis teralokasi; sisa uang baru
   * menjadi deposit baru (DEP / VDP, source BATCH). Invoice dikunci (bentrok dengan retur / batal).
   */
  const create = async (req, res) => {
    try {
      const body = req.body || {};
      const partyId = body[partyField];
      if (!mongoose.isValidObjectId(partyId)) return errorResponse(res, `Please select a ${partyField}`, 400);
      const cashRaw = body.amount === undefined || body.amount === null || body.amount === '' ? 0 : body.amount;
      const amountErr = checkAmount(cashRaw, 'Amount', { min: 0 });
      if (amountErr) return errorResponse(res, amountErr, 400);
      const amount = round2(cashRaw);
      if (amount > 0 && !METHODS.includes(body.method)) return errorResponse(res, 'Please select a payment method', 400);
      const date = body.date ? new Date(body.date) : new Date();
      if (Number.isNaN(date.getTime())) return errorResponse(res, 'Invalid payment date', 400);
      const endOfToday = new Date();
      endOfToday.setHours(23, 59, 59, 999);
      if (date > endOfToday) return errorResponse(res, 'Payment date cannot be in the future', 400);
      const note = trimText(body.note);

      // deposit yang dipakai
      const depSeen = new Set();
      const depositUses = [];
      for (const [i, d] of (Array.isArray(body.deposits) ? body.deposits : []).filter((x) => Number(x?.amount) > 0).entries()) {
        if (!mongoose.isValidObjectId(d.deposit)) return errorResponse(res, `Deposit ${i + 1}: invalid deposit`, 400);
        if (depSeen.has(String(d.deposit))) return errorResponse(res, `Deposit ${i + 1}: the same deposit appears more than once`, 400);
        depSeen.add(String(d.deposit));
        const err = checkAmount(d.amount, 'Deposit amount', { min: 0, exclusive: true });
        if (err) return errorResponse(res, `Deposit ${i + 1}: ${err}`, 400);
        depositUses.push({ deposit: String(d.deposit), amount: round2(d.amount) });
      }
      const depositTotal = round2(depositUses.reduce((sum, d) => sum + d.amount, 0));

      const input = (Array.isArray(body.allocations) ? body.allocations : [])
        .filter((a) => Number(a?.amount || 0) !== 0 || Number(a?.writeOff || 0) !== 0);
      if (input.length > MAX_ALLOCATIONS) return errorResponse(res, `At most ${MAX_ALLOCATIONS} invoices per payment`, 400);
      const seen = new Set();
      const allocations = [];
      for (const [i, a] of input.entries()) {
        if (!mongoose.isValidObjectId(a?.invoice)) return errorResponse(res, `Line ${i + 1}: invalid invoice`, 400);
        if (seen.has(String(a.invoice))) return errorResponse(res, `Line ${i + 1}: the same invoice appears more than once`, 400);
        seen.add(String(a.invoice));
        const err = checkAmount(a.amount || 0, 'Allocated amount', { min: 0 });
        if (err) return errorResponse(res, `Line ${i + 1}: ${err}`, 400);
        let wo;
        try {
          wo = parseWriteOff(cfg.side, { writeOffAmount: a.writeOff, writeOffReason: a.writeOffReason }, note);
        } catch (e) {
          return errorResponse(res, `Line ${i + 1}: ${e.message}`, 400);
        }
        allocations.push({ invoice: String(a.invoice), amount: round2(a.amount || 0), ...wo });
      }
      const allocated = round2(allocations.reduce((sum, a) => sum + a.amount, 0));
      const funds = round2(amount + depositTotal);
      if (funds <= 0 && !allocations.some((a) => a.writeOffAmount > 0)) return errorResponse(res, 'Enter an amount', 400);
      if (allocated > funds) return errorResponse(res, `Allocated ${fmt(allocated)} exceeds the money available ${fmt(funds)}`, 400);
      if (depositTotal > allocated) {
        return errorResponse(res, `Deposits used (${fmt(depositTotal)}) must be fully allocated; allocated ${fmt(allocated)}`, 400);
      }
      const leftover = round2(funds - allocated); // dari uang baru -> deposit baru
      if (!allocations.length && !leftover) return errorResponse(res, 'Allocate the amount to at least one invoice', 400);

      const doc = await runInTransaction(async () => {
        await lock(ref(partyField, partyId), allocations.map((a) => ref(cfg.invoiceEntity, a.invoice)));
        const party = await Party.findById(partyId).select(`${partyName} isWalkIn`).lean();
        if (!party) throw new HttpError(`${partyField} not found`, 404);
        if (leftover > 0 && party.isWalkIn) throw new HttpError('Overpayments become a deposit, which needs a named customer', 400);
        const invoices = await Invoice.find({ _id: { $in: allocations.map((a) => a.invoice) } });
        if (invoices.length !== allocations.length) throw new HttpError('One or more invoices no longer exist', 400);
        const byId = new Map(invoices.map((inv) => [String(inv._id), inv]));
        const settings = await getSettings();

        const batch = new Batch({
          no: await nextDocNo(cfg.prefix),
          [partyField]: partyId,
          date,
          method: amount > 0 ? body.method : 'OTHER',
          amount,
          deposits: depositUses,
          reference: trimText(body.reference, 100),
          note,
          createdBy: req.user._id,
        });
        const batchId = audit.newBatchId();
        // sumber dana berurutan: deposit dulu, lalu uang baru
        const pools = depositUses.map((d) => ({ method: 'DEPOSIT', depositId: d.deposit, left: d.amount }));
        pools.push({ method: body.method, depositId: null, left: amount });
        const payNote = trimText([batch.no, note].filter(Boolean).join(' · '));
        for (const a of allocations) {
          const inv = byId.get(a.invoice);
          if (!cfg.canAccessInvoice(req, inv)) throw new HttpError("You don't have access to this warehouse", 403);
          if (String(inv[partyField]) !== String(partyId)) throw new HttpError(`${inv.no} does not belong to ${party[partyName]}`, 400);
          await assertWriteOffAllowed(req, cfg.side, a.writeOffAmount, a.writeOffReason, settings);
          const { balance } = invoiceBalance(inv);
          if (round2(a.amount + a.writeOffAmount) > balance) {
            throw new HttpError(`${inv.no}: ${fmt(a.amount + a.writeOffAmount)} (payment + write-off) exceeds the outstanding balance ${fmt(balance)}`, 400);
          }
          const paymentIds = [];
          let need = a.amount;
          let writeOff = a.writeOffAmount;
          for (const pool of pools) {
            if (need <= 0) break;
            if (pool.left <= 0) continue;
            const take = round2(Math.min(need, pool.left));
            const { payment } = await recordPayment(req, cfg.side, inv, {
              date, method: pool.method, amount: take, depositId: pool.depositId,
              writeOffAmount: writeOff, writeOffReason: writeOff ? a.writeOffReason : null,
              batch: batch._id, extra: cfg.paymentExtra(inv), reference: batch.reference, note: payNote, batchId,
            });
            writeOff = 0; // potongan dicatat sekali, di pembayaran pertama invoice tsb
            pool.left = round2(pool.left - take);
            need = round2(need - take);
            paymentIds.push(payment._id);
          }
          if (writeOff > 0) { // hanya potongan (tanpa uang)
            const { payment } = await recordPayment(req, cfg.side, inv, {
              date, amount: 0, writeOffAmount: writeOff, writeOffReason: a.writeOffReason,
              batch: batch._id, extra: cfg.paymentExtra(inv), reference: batch.reference, note: payNote, batchId,
            });
            paymentIds.push(payment._id);
          }
          batch.allocations.push({
            [invoiceField]: inv._id, payment: paymentIds[0] || null, payments: paymentIds, amount: a.amount,
            writeOff: a.writeOffAmount, writeOffReason: a.writeOffReason,
          });
        }
        if (leftover > 0) {
          const dep = await mongoose.model(s.Deposit).create({
            no: await nextDocNo(s.depositPrefix),
            [partyField]: partyId,
            date,
            source: 'BATCH',
            method: body.method,
            amount: leftover,
            batch: batch._id,
            reference: batch.reference,
            note: `Overpayment of ${batch.no}`,
            createdBy: req.user._id,
          });
          batch.depositCreated = dep._id;
          await audit.logCreate(req, s.depositEntity, [dep], { batchId });
        }
        await batch.save();
        await audit.logCreate(req, cfg.entity, [batch], { batchId });
        return batch;
      });
      const extra = doc.depositCreated ? ` (+ ${fmt(leftover)} to deposit)` : '';
      return successResponse(res, doc, `${doc.no} recorded for ${doc.allocations.length} invoice(s)${extra}`, 201);
    } catch (error) {
      return handleError(res, error);
    }
  };

  /** POST /:id/cancel { reason } — semua pembayaran alokasinya dibatalkan, sisa invoice & saldo deposit kembali */
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
        const invoices = await Invoice.find({ _id: { $in: invIds } }).select('gudang gudangs');
        if (invoices.some((inv) => !cfg.canAccessInvoice(req, inv))) throw new HttpError("You don't have access to this warehouse", 403);
        const batchId = audit.newBatchId();
        // deposit dari kelebihan uang: hanya bisa batal bila belum dipakai / dikembalikan
        if (doc.depositCreated) {
          const dep = await mongoose.model(s.Deposit).findById(doc.depositCreated);
          if (dep && dep.status === 'POSTED') {
            if ((dep.usedAmount || 0) > 0 || (dep.refundedAmount || 0) > 0) {
              throw new HttpError(`Deposit ${dep.no} from this payment has been used or refunded. Cancel that first.`, 400);
            }
            const dBefore = await audit.snap(s.depositEntity, [dep]);
            Object.assign(dep, { status: 'CANCELLED', cancelReason: reason, cancelledBy: req.user._id, cancelledDate: new Date() });
            await dep.save();
            await audit.logUpdate(req, s.depositEntity, dBefore, [dep], { batchId });
          }
        }
        const before = await audit.snap(cfg.entity, [doc]);
        for (const a of doc.allocations) {
          const ids = a.payments?.length ? a.payments : [a.payment].filter(Boolean);
          for (const id of ids) {
            const payment = await Payment.findById(id);
            if (!payment || payment.status !== 'POSTED') continue;
            await reversePayment(req, cfg.side, payment, reason, { batchId });
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
  side: 'sales',
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
  invoiceSelect: 'no date dueDate total returnedAmount paidAmount writtenOffAmount paymentStatus gudang customer',
  listKey: 'dataCustomerReceipt',
  invoiceScope: (req) => {
    const scope = gudangScope(req);
    return scope ? { gudang: { $in: scope } } : null;
  },
  canAccessInvoice: (req, inv) => canAccessGudang(req, gudangOf(inv)),
  paymentExtra: (inv) => ({ gudang: inv.gudang }),
});

exports.vendorPaymentBatch = makeBatchController({
  side: 'purchase',
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
  invoiceSelect: 'no vendorInvoiceNo date dueDate total returnedAmount paidAmount writtenOffAmount paymentStatus gudangs vendor',
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
