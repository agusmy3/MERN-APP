const mongoose = require('mongoose');
const { successResponse, errorResponse } = require('../helpers/responseHelper');
const audit = require('../helpers/auditLogger');
const { runInTransaction, HttpError, lock, ref } = require('../helpers/transaction');
const { nextDocNo } = require('../helpers/stockHelper');
const { checkAmount, round2 } = require('../helpers/number');
const { invoiceBalance } = require('../helpers/salesHelper');
const { depositBalance, BALANCE_EXPR, DEPOSIT_WRITE_OFF_REASONS } = require('../helpers/depositSchema');
const { getSettings } = require('../helpers/settings');
const { SIDES, applyToInvoice, recordPayment, reversePayment } = require('../helpers/paymentHelper');
const { gudangScope, canAccessGudang } = require('../helpers/gudangAccess');

/**
 * Deposit / uang muka (helpers/depositSchema.js), dipakai 2x:
 *   /api/customer-deposit : deposit customer (izin salesPayment: view, create = catat / pakai / kembalikan, update = batalkan)
 *   /api/vendor-deposit   : uang muka ke vendor (izin vendorPayment + vendorPrice:view)
 * Pakai deposit = pembayaran PAYMENT metode DEPOSIT (helpers/paymentHelper.js recordPayment), jadi status bayar,
 * umur piutang / hutang & laporan tetap dari pembayaran biasa.
 */
const METHODS = ['CASH', 'TRANSFER', 'OTHER'];
const SORTABLE_FIELDS = ['no', 'date', 'amount', 'createdDate'];
const MAX_ALLOCATIONS = 200;

const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status);
  if (error.name === 'ValidationError' || error.name === 'CastError') return errorResponse(res, error.message, 400);
  return errorResponse(res, error.message, 500);
};
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const trimText = (v, max = 500) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));
const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const parseDate = (v) => {
  const date = v ? new Date(v) : new Date();
  if (Number.isNaN(date.getTime())) throw new HttpError('Invalid date', 400);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  if (date > endOfToday) throw new HttpError('Date cannot be in the future', 400);
  return date;
};
const DAY = 24 * 60 * 60 * 1000;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
/** Batas umur deposit bersaldo (setting payment.depositAgeAlertDays; 0 = mati) */
const alertDaysOf = async () => Math.max(0, Number((await getSettings())['payment.depositAgeAlertDays'] ?? 60) || 0);
/** Tanggal deposit yang lebih lama dari ini = "lama" */
const agedCutoff = (days) => new Date(startOfToday().getTime() - days * DAY);

const parseAmount = (v, label = 'Amount') => {
  const err = checkAmount(v, label, { min: 0, exclusive: true });
  if (err) throw new HttpError(err, 400);
  return round2(v);
};

/**
 * cfg: { side ('sales'|'purchase'), Deposit, Party, partyName, Order, orderField, orderLabel, listKey,
 *        invoiceScope(req), canAccessInvoice(req, inv), paymentExtra(inv) }
 */
const makeDepositController = (cfg) => {
  const s = SIDES[cfg.side];
  const { Deposit, Party, partyName, orderField } = cfg;
  const { partyField, invoiceField } = s;
  const Invoice = mongoose.model(s.Invoice);
  const Payment = mongoose.model(s.Payment);
  // + umur (hari sejak tanggal deposit) untuk deposit yang masih bersaldo; aged = lebih lama dari setting
  const withBalance = (d, alertDays = 0) => {
    const balance = depositBalance(d);
    const ageDays = balance > 0 ? Math.max(0, Math.floor((startOfToday() - new Date(d.date).setHours(0, 0, 0, 0)) / DAY)) : null;
    return { ...d, balance, ageDays, aged: !!(alertDays && ageDays !== null && ageDays > alertDays) };
  };

  /** GET / — filter search (no / referensi / catatan / nama), status, <party>, hasBalance=true, aged=true, from, to */
  const list = async (req, res) => {
    try {
      const page = Math.max(parseInt(req.query.page || 1) || 1, 1);
      const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || 10) || 10, 1), 100);
      const sortField = SORTABLE_FIELDS.includes(req.query.sortField) ? req.query.sortField : 'createdDate';
      const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
      const filter = {};
      if (['POSTED', 'CANCELLED'].includes(req.query.status)) filter.status = req.query.status;
      const alertDays = await alertDaysOf();
      if (req.query.hasBalance === 'true' || req.query.aged === 'true') {
        filter.status = 'POSTED';
        filter.$expr = { $gt: [BALANCE_EXPR, 0] };
        if (req.query.aged === 'true') filter.date = { $lt: agedCutoff(alertDays || 0) };
      }
      if (req.query[partyField]) {
        if (!mongoose.isValidObjectId(req.query[partyField])) return errorResponse(res, `Invalid ${partyField}`, 400);
        filter[partyField] = req.query[partyField];
      }
      if (req.query.from || req.query.to) {
        filter.date = { ...(filter.date || {}) }; // tetap gabung dengan batas umur (aged)
        if (req.query.from) filter.date.$gte = new Date(`${req.query.from}T00:00:00`);
        if (req.query.to) filter.date.$lte = new Date(`${req.query.to}T23:59:59.999`);
      }
      if (req.query.search) {
        const rx = { $regex: escapeRegex(req.query.search), $options: 'i' };
        const parties = await Party.find({ [partyName]: rx }).distinct('_id');
        filter.$or = [{ no: rx }, { reference: rx }, { note: rx }, { [partyField]: { $in: parties } }];
      }
      const [totalData, rows, sum] = await Promise.all([
        Deposit.countDocuments(filter),
        Deposit.find(filter)
          .select('-refunds')
          .populate(partyField, partyName)
          .populate(orderField, 'no')
          .populate('createdBy', 'name')
          .sort({ [sortField]: sortOrder, _id: -1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .lean(),
        Deposit.aggregate([
          { $match: Deposit.where({ ...filter, status: 'POSTED', ...(filter.status === 'CANCELLED' ? { _id: null } : {}) }).cast(Deposit) },
          { $group: { _id: null, bal: { $sum: { $subtract: ['$amount', { $add: [{ $ifNull: ['$usedAmount', 0] }, { $ifNull: ['$refundedAmount', 0] }, { $ifNull: ['$writtenOffAmount', 0] }] }] } } } },
        ]),
      ]);
      return successResponse(res, {
        [cfg.listKey]: rows.map((d) => withBalance(d, alertDays)),
        alertDays,
        totalBalance: round2(sum[0]?.bal || 0),
        totalData,
        currentPage: page,
        totalPages: Math.ceil(totalData / pageSize),
      });
    } catch (error) {
      return handleError(res, error);
    }
  };

  /** GET /open?<party>= — deposit bersaldo milik pihak tsb, terlama dulu (pilihan "bayar dari deposit") */
  const open = async (req, res) => {
    try {
      const partyId = req.query[partyField];
      if (!mongoose.isValidObjectId(partyId)) return errorResponse(res, `Please select a ${partyField}`, 400);
      const rows = await Deposit.find({ [partyField]: partyId, status: 'POSTED' })
        .select('no date amount usedAmount refundedAmount writtenOffAmount status reference note source').sort({ date: 1, _id: 1 }).lean();
      const alertDays = await alertDaysOf();
      return successResponse(res, rows.map((d) => withBalance(d, alertDays)).filter((d) => d.balance > 0));
    } catch (error) {
      return handleError(res, error);
    }
  };

  /** GET /:id — + balance, usages (pembayaran dari / ke deposit ini) */
  const get = async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 'Deposit not found', 404);
      const doc = await Deposit.findById(req.params.id)
        .populate(partyField)
        .populate(orderField, 'no status')
        .populate(invoiceField, 'no')
        .populate('batch', 'no')
        .populate('createdBy', 'name')
        .populate('cancelledBy', 'name')
        .populate('refunds.createdBy', 'name')
        .populate('writeOffs.createdBy', 'name')
        .lean();
      if (!doc) return errorResponse(res, 'Deposit not found', 404);
      Object.assign(doc, withBalance(doc, await alertDaysOf()));
      const usages = await Payment.find({ deposit: doc._id })
        .populate(invoiceField, `no date total ${cfg.side === 'purchase' ? 'vendorInvoiceNo gudangs' : 'gudang'}`)
        .populate('createdBy', 'name')
        .sort({ date: 1, _id: 1 }).lean();
      // invoice di gudang yang tidak boleh diakses: nomornya disembunyikan
      doc.usages = usages.map((u) => (u[invoiceField] && !cfg.canAccessInvoice(req, u[invoiceField])
        ? { ...u, [invoiceField]: { _id: null, no: '(restricted)' } } : u));
      return successResponse(res, doc);
    } catch (error) {
      return handleError(res, error);
    }
  };

  /** POST / — { <party>, date, method, amount, reference, note, <order>? } uang muka langsung */
  const create = async (req, res) => {
    try {
      const body = req.body || {};
      const partyId = body[partyField];
      if (!mongoose.isValidObjectId(partyId)) return errorResponse(res, `Please select a ${partyField}`, 400);
      if (!METHODS.includes(body.method)) return errorResponse(res, 'Please select a payment method', 400);
      const amount = parseAmount(body.amount);
      const date = parseDate(body.date);
      const orderId = body[orderField] || null;
      if (orderId && !mongoose.isValidObjectId(orderId)) return errorResponse(res, `Invalid ${cfg.orderLabel}`, 400);
      const doc = await runInTransaction(async () => {
        const party = await Party.findById(partyId).select(`${partyName} isWalkIn isActive`).lean();
        if (!party) throw new HttpError(`${partyField} not found`, 404);
        if (party.isWalkIn) throw new HttpError('Deposits need a named customer, not the walk-in customer', 400);
        if (orderId) {
          const order = await cfg.Order.findById(orderId).select(`no status ${partyField}`).lean();
          if (!order || String(order[partyField]) !== String(partyId)) throw new HttpError(`${cfg.orderLabel} not found for this ${partyField}`, 400);
          if (order.status === 'CANCELLED') throw new HttpError(`${order.no} is cancelled`, 400);
        }
        const doc = await Deposit.create({
          no: await nextDocNo(s.depositPrefix),
          [partyField]: partyId,
          date,
          source: 'DIRECT',
          method: body.method,
          amount,
          [orderField]: orderId,
          reference: trimText(body.reference, 100),
          note: trimText(body.note),
          createdBy: req.user._id,
        });
        await audit.logCreate(req, s.depositEntity, [doc]);
        return doc;
      });
      return successResponse(res, doc, `${doc.no} recorded`, 201);
    } catch (error) {
      return handleError(res, error);
    }
  };

  /**
   * POST /from-invoice — { <invoice>, amount?, date, note } kelebihan bayar invoice / tagihan OVERPAID dipindah ke deposit
   * (default seluruh kelebihan): deposit source OVERPAYMENT + pembayaran REFUND metode DEPOSIT.
   */
  const fromInvoice = async (req, res) => {
    try {
      const body = req.body || {};
      const invId = body[invoiceField];
      if (!mongoose.isValidObjectId(invId)) return errorResponse(res, `Please select the ${s.invoiceLabel}`, 400);
      const date = parseDate(body.date);
      const doc = await runInTransaction(async () => {
        await lock(ref(s.invoiceEntity, invId));
        const inv = await Invoice.findById(invId);
        if (!inv) throw new HttpError(`${s.invoiceLabel} not found`, 404);
        if (!cfg.canAccessInvoice(req, inv)) throw new HttpError("You don't have access to this warehouse", 403);
        if (inv.status !== 'POSTED') throw new HttpError(`${inv.no} is not posted`, 400);
        const over = -invoiceBalance(inv).balance;
        if (over <= 0) throw new HttpError(`${inv.no} is not overpaid`, 400);
        const amount = body.amount === undefined || body.amount === null || body.amount === '' ? round2(over) : parseAmount(body.amount);
        if (amount > over) throw new HttpError(`${fmt(amount)} exceeds the overpaid amount ${fmt(over)}`, 400);
        const batchId = audit.newBatchId();
        const deposit = await Deposit.create({
          no: await nextDocNo(s.depositPrefix),
          [partyField]: inv[partyField],
          date,
          source: 'OVERPAYMENT',
          method: null,
          amount,
          [invoiceField]: inv._id,
          note: trimText(body.note) || `Overpayment of ${inv.no}`,
          createdBy: req.user._id,
        });
        const payment = await Payment.create({
          no: await nextDocNo(s.refundPrefix),
          type: 'REFUND',
          [invoiceField]: inv._id,
          [partyField]: inv[partyField],
          ...cfg.paymentExtra(inv),
          deposit: deposit._id,
          date,
          method: 'DEPOSIT',
          amount,
          note: `Moved to deposit ${deposit.no}`,
          createdBy: req.user._id,
        });
        const before = await audit.snap(s.invoiceEntity, [inv]);
        applyToInvoice(inv, -amount);
        await inv.save();
        await audit.logCreate(req, s.depositEntity, [deposit], { batchId });
        await audit.logCreate(req, s.paymentEntity, [payment], { batchId });
        await audit.logUpdate(req, s.invoiceEntity, before, [inv], { batchId });
        return deposit;
      });
      return successResponse(res, doc, `${doc.no} created from the overpayment`, 201);
    } catch (error) {
      return handleError(res, error);
    }
  };

  /** POST /:id/apply — { date, allocations: [{ invoice, amount }] } pakai saldo deposit untuk invoice / tagihan */
  const apply = async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 'Deposit not found', 404);
      const body = req.body || {};
      const date = parseDate(body.date);
      const input = (Array.isArray(body.allocations) ? body.allocations : []).filter((a) => Number(a?.amount) > 0);
      if (!input.length) return errorResponse(res, `Allocate the deposit to at least one ${s.invoiceLabel}`, 400);
      if (input.length > MAX_ALLOCATIONS) return errorResponse(res, `At most ${MAX_ALLOCATIONS} ${s.invoiceLabel}s at once`, 400);
      const seen = new Set();
      const allocations = input.map((a, i) => {
        if (!mongoose.isValidObjectId(a.invoice)) throw new HttpError(`Line ${i + 1}: invalid ${s.invoiceLabel}`, 400);
        if (seen.has(String(a.invoice))) throw new HttpError(`Line ${i + 1}: the same ${s.invoiceLabel} appears more than once`, 400);
        seen.add(String(a.invoice));
        return { invoice: String(a.invoice), amount: parseAmount(a.amount, 'Allocated amount') };
      });
      const total = round2(allocations.reduce((sum, a) => sum + a.amount, 0));
      const doc = await runInTransaction(async () => {
        const dep = await Deposit.findById(req.params.id);
        if (!dep) throw new HttpError('Deposit not found', 404);
        if (dep.status !== 'POSTED') throw new HttpError(`${dep.no} is cancelled`, 400);
        if (total > depositBalance(dep)) throw new HttpError(`Allocated ${fmt(total)} exceeds the deposit balance ${fmt(depositBalance(dep))}`, 400);
        await lock(...allocations.map((a) => ref(s.invoiceEntity, a.invoice)));
        const batchId = audit.newBatchId();
        for (const a of allocations) {
          const inv = await Invoice.findById(a.invoice);
          if (!inv) throw new HttpError(`${s.invoiceLabel} not found`, 404);
          if (!cfg.canAccessInvoice(req, inv)) throw new HttpError("You don't have access to this warehouse", 403);
          if (String(inv[partyField]) !== String(dep[partyField])) throw new HttpError(`${inv.no} belongs to another ${partyField}`, 400);
          await recordPayment(req, cfg.side, inv, {
            date, method: 'DEPOSIT', amount: a.amount, depositId: dep._id, extra: cfg.paymentExtra(inv),
            reference: dep.no, note: trimText(body.note) || `From deposit ${dep.no}`, batchId,
          });
        }
        return Deposit.findById(dep._id);
      });
      return successResponse(res, doc, `${doc.no}: ${fmt(total)} applied to ${allocations.length} ${s.invoiceLabel}(s)`);
    } catch (error) {
      return handleError(res, error);
    }
  };

  /** POST /:id/refund — { date, method, amount, reference, note } saldo dikembalikan (uang keluar / masuk lagi) */
  const refund = async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 'Deposit not found', 404);
      const body = req.body || {};
      if (!METHODS.includes(body.method)) return errorResponse(res, 'Please select a payment method', 400);
      const amount = parseAmount(body.amount);
      const date = parseDate(body.date);
      const doc = await runInTransaction(async () => {
        const dep = await Deposit.findById(req.params.id);
        if (!dep) throw new HttpError('Deposit not found', 404);
        if (dep.status !== 'POSTED') throw new HttpError(`${dep.no} is cancelled`, 400);
        if (amount > depositBalance(dep)) throw new HttpError(`Refund ${fmt(amount)} exceeds the deposit balance ${fmt(depositBalance(dep))}`, 400);
        const before = await audit.snap(s.depositEntity, [dep]);
        dep.refunds.push({ date, method: body.method, amount, reference: trimText(body.reference, 100), note: trimText(body.note), createdBy: req.user._id });
        dep.refundedAmount = round2((dep.refundedAmount || 0) + amount);
        await dep.save();
        await audit.logUpdate(req, s.depositEntity, before, [dep]);
        return dep;
      });
      return successResponse(res, doc, `${fmt(amount)} refunded from ${doc.no}`);
    } catch (error) {
      return handleError(res, error);
    }
  };

  /** POST /:id/refunds/:refundId/cancel — { reason } saldo kembali */
  const cancelRefund = async (req, res) => {
    try {
      const reason = trimText(req.body?.reason);
      if (!reason) return errorResponse(res, 'Cancellation reason is required', 400);
      if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 'Deposit not found', 404);
      const doc = await runInTransaction(async () => {
        const dep = await Deposit.findById(req.params.id);
        if (!dep) throw new HttpError('Deposit not found', 404);
        const r = dep.refunds.id(req.params.refundId);
        if (!r) throw new HttpError('Refund not found', 404);
        if (r.status !== 'POSTED') throw new HttpError('Refund is already cancelled', 400);
        const before = await audit.snap(s.depositEntity, [dep]);
        Object.assign(r, { status: 'CANCELLED', cancelReason: reason, cancelledBy: req.user._id, cancelledDate: new Date() });
        dep.refundedAmount = round2(Math.max(0, (dep.refundedAmount || 0) - r.amount));
        await dep.save();
        await audit.logUpdate(req, s.depositEntity, before, [dep]);
        return dep;
      });
      return successResponse(res, doc, `Refund cancelled on ${doc.no}`);
    } catch (error) {
      return handleError(res, error);
    }
  };

  /**
   * POST /:id/cancel — { reason } hanya selama belum dipakai & belum dikembalikan. Dari pembayaran gabungan: batal lewat
   * pembayaran gabungannya. Dari kelebihan bayar: pembayaran REFUND-nya ikut batal (invoice kembali kelebihan bayar).
   */
  const cancel = async (req, res) => {
    try {
      const reason = trimText(req.body?.reason);
      if (!reason) return errorResponse(res, 'Cancellation reason is required', 400);
      if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 'Deposit not found', 404);
      const doc = await runInTransaction(async () => {
        const dep = await Deposit.findById(req.params.id);
        if (!dep) throw new HttpError('Deposit not found', 404);
        if (dep.status !== 'POSTED') throw new HttpError(`${dep.no} is already cancelled`, 400);
        if (dep.source === 'BATCH') {
          const batch = await mongoose.model(s.Batch).findById(dep.batch).select('no').lean();
          throw new HttpError(`${dep.no} came from combined payment ${batch?.no || ''}. Cancel that payment instead.`, 400);
        }
        if ((dep.usedAmount || 0) > 0) throw new HttpError(`${dep.no} has been used for payments. Cancel those payments first.`, 400);
        if ((dep.refundedAmount || 0) > 0) throw new HttpError(`${dep.no} has refunds. Cancel them first.`, 400);
        if ((dep.writtenOffAmount || 0) > 0) throw new HttpError(`${dep.no} has write-offs. Cancel them first.`, 400);
        const batchId = audit.newBatchId();
        if (dep.source === 'OVERPAYMENT') {
          const payment = await Payment.findOne({ deposit: dep._id, type: 'REFUND', status: 'POSTED' });
          if (payment) await reversePayment(req, cfg.side, payment, reason, { batchId });
        }
        const before = await audit.snap(s.depositEntity, [dep]);
        Object.assign(dep, { status: 'CANCELLED', cancelReason: reason, cancelledBy: req.user._id, cancelledDate: new Date() });
        await dep.save();
        await audit.logUpdate(req, s.depositEntity, before, [dep], { batchId });
        return dep;
      });
      return successResponse(res, doc, `${doc.no} cancelled`);
    } catch (error) {
      return handleError(res, error);
    }
  };

  /**
   * POST /:id/write-off — { date, amount (default sisa saldo), reason, note } hapus saldo yang tidak akan kembali
   * (vendor tidak mengakui / tutup) atau hangus (customer). Selalu butuh <resource>:approve (dicek di route).
   */
  const writeOff = async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 'Deposit not found', 404);
      const body = req.body || {};
      const reasons = DEPOSIT_WRITE_OFF_REASONS[cfg.side];
      if (!reasons.includes(body.reason)) return errorResponse(res, `Select a reason (${reasons.join(', ')})`, 400);
      const note = trimText(body.note);
      if (!note) return errorResponse(res, 'A note is required to write off a deposit (who confirmed it, evidence, etc.)', 400);
      const date = parseDate(body.date);
      const doc = await runInTransaction(async () => {
        const dep = await Deposit.findById(req.params.id);
        if (!dep) throw new HttpError('Deposit not found', 404);
        if (dep.status !== 'POSTED') throw new HttpError(`${dep.no} is cancelled`, 400);
        const bal = depositBalance(dep);
        if (bal <= 0) throw new HttpError(`${dep.no} has no balance left`, 400);
        const amount = body.amount === undefined || body.amount === null || body.amount === '' ? bal : parseAmount(body.amount);
        if (amount > bal) throw new HttpError(`Write-off ${fmt(amount)} exceeds the deposit balance ${fmt(bal)}`, 400);
        const before = await audit.snap(s.depositEntity, [dep]);
        dep.writeOffs.push({ date, amount, reason: body.reason, note, createdBy: req.user._id });
        dep.writtenOffAmount = round2((dep.writtenOffAmount || 0) + amount);
        await dep.save();
        await audit.logUpdate(req, s.depositEntity, before, [dep]);
        return dep;
      });
      return successResponse(res, doc, `${fmt(doc.writeOffs[doc.writeOffs.length - 1].amount)} written off from ${doc.no}`);
    } catch (error) {
      return handleError(res, error);
    }
  };

  /** POST /:id/write-offs/:writeOffId/cancel — { reason } saldo kembali (mis. vendor akhirnya mengakui) */
  const cancelWriteOff = async (req, res) => {
    try {
      const reason = trimText(req.body?.reason);
      if (!reason) return errorResponse(res, 'Cancellation reason is required', 400);
      if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 'Deposit not found', 404);
      const doc = await runInTransaction(async () => {
        const dep = await Deposit.findById(req.params.id);
        if (!dep) throw new HttpError('Deposit not found', 404);
        const w = dep.writeOffs.id(req.params.writeOffId);
        if (!w) throw new HttpError('Write-off not found', 404);
        if (w.status !== 'POSTED') throw new HttpError('Write-off is already cancelled', 400);
        const before = await audit.snap(s.depositEntity, [dep]);
        Object.assign(w, { status: 'CANCELLED', cancelReason: reason, cancelledBy: req.user._id, cancelledDate: new Date() });
        dep.writtenOffAmount = round2(Math.max(0, (dep.writtenOffAmount || 0) - w.amount));
        await dep.save();
        await audit.logUpdate(req, s.depositEntity, before, [dep]);
        return dep;
      });
      return successResponse(res, doc, `Write-off cancelled on ${doc.no}`);
    } catch (error) {
      return handleError(res, error);
    }
  };

  return { list, open, get, create, fromInvoice, apply, refund, cancelRefund, writeOff, cancelWriteOff, cancel };
};

const gudangOf = (inv) => inv.gudang?._id ?? inv.gudang;

exports.customerDeposit = makeDepositController({
  side: 'sales',
  Deposit: require('../models/CustomerDeposit'),
  Party: require('../models/Customer'),
  partyName: 'name',
  Order: require('../models/SalesOrder'),
  orderField: 'salesOrder',
  orderLabel: 'Sales order',
  listKey: 'dataCustomerDeposit',
  canAccessInvoice: (req, inv) => canAccessGudang(req, gudangOf(inv)),
  paymentExtra: (inv) => ({ gudang: inv.gudang }),
});

exports.vendorDeposit = makeDepositController({
  side: 'purchase',
  Deposit: require('../models/VendorDeposit'),
  Party: require('../models/Vendor'),
  partyName: 'companyName',
  Order: require('../models/PurchaseOrder'),
  orderField: 'purchaseOrder',
  orderLabel: 'Purchase order',
  listKey: 'dataVendorDeposit',
  canAccessInvoice: (req, inv) => {
    const scope = gudangScope(req);
    return !scope || (inv.gudangs || []).some((g) => scope.includes(String(g?._id ?? g)));
  },
  paymentExtra: () => ({}),
});

/**
 * Ringkasan deposit bersaldo yang lebih lama dari setting payment.depositAgeAlertDays (dashboard):
 * side 'sales' | 'purchase' -> { days, count, amount } atau null bila peringatan dimatikan.
 */
exports.agedDepositSummary = async (side) => {
  const days = await alertDaysOf();
  if (!days) return null;
  const Deposit = mongoose.model(SIDES[side].Deposit);
  const [r] = await Deposit.aggregate([
    { $match: { status: 'POSTED', date: { $lt: agedCutoff(days) } } },
    { $project: { bal: BALANCE_EXPR } },
    { $match: { bal: { $gt: 0 } } },
    { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$bal' } } },
  ]);
  return { days, count: r?.count || 0, amount: round2(r?.amount || 0) };
};
