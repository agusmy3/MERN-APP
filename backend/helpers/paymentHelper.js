const mongoose = require('mongoose');
const audit = require('./auditLogger');
const { HttpError, lock, ref } = require('./transaction');
const { nextDocNo } = require('./stockHelper');
const { checkAmount, round2 } = require('./number');
const { invoiceBalance } = require('./salesHelper');
const { depositBalance } = require('./depositSchema');
const { getSettings } = require('./settings');
const { hasPermission } = require('../config/permissions');

/**
 * Inti pembayaran invoice penjualan / tagihan vendor (dipakai pembayaran tunggal, pembayaran gabungan & deposit):
 * - potongan (write-off): `writeOffAmount` + alasan di dokumen pembayaran, dijumlah di `invoice.writtenOffAmount`
 *   (bukan uang); di atas setting `payment.writeOffLimit` (dan alasan BAD_DEBT) butuh izin <resource>:approve.
 * - metode DEPOSIT: PAYMENT dibayar dari saldo deposit (`deposit.usedAmount`); REFUND = kelebihan bayar dipindah ke
 *   deposit (deposit source OVERPAYMENT, dibatalkan lewat deposit-nya).
 * Semua fungsi dipanggil DI DALAM runInTransaction.
 */
const SIDES = {
  sales: {
    Payment: 'SalesPayment', Invoice: 'SalesInvoice', Deposit: 'CustomerDeposit', Batch: 'CustomerReceipt',
    partyField: 'customer', invoiceField: 'salesInvoice', resource: 'salesPayment',
    paymentEntity: 'salesPayment', invoiceEntity: 'salesInvoice', depositEntity: 'customerDeposit',
    payPrefix: 'PAY', refundPrefix: 'RFD', depositPrefix: 'DEP',
    reasons: ['DISCOUNT', 'BANK_FEE', 'ROUNDING', 'BAD_DEBT'], approvalReasons: ['BAD_DEBT'], noteReasons: [],
    invoiceLabel: 'invoice',
  },
  purchase: {
    Payment: 'VendorPayment', Invoice: 'PurchaseInvoice', Deposit: 'VendorDeposit', Batch: 'VendorPaymentBatch',
    partyField: 'vendor', invoiceField: 'purchaseInvoice', resource: 'vendorPayment',
    paymentEntity: 'vendorPayment', invoiceEntity: 'purchaseInvoice', depositEntity: 'vendorDeposit',
    payPrefix: 'VPAY', refundPrefix: 'VRF', depositPrefix: 'VDP',
    reasons: ['DISCOUNT', 'ROUNDING', 'OTHER'], approvalReasons: [], noteReasons: ['OTHER'],
    invoiceLabel: 'bill',
  },
};
const model = (name) => mongoose.model(name);
const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

/** Potongan dari input -> { writeOffAmount, writeOffReason } (validasi murni) */
const parseWriteOff = (side, input = {}, note = '') => {
  const s = SIDES[side];
  const raw = input.writeOffAmount ?? input.writeOff;
  if (raw === undefined || raw === null || raw === '' || Number(raw) === 0) return { writeOffAmount: 0, writeOffReason: null };
  const err = checkAmount(raw, 'Write-off', { min: 0, exclusive: true });
  if (err) throw new HttpError(err, 400);
  const reason = input.writeOffReason;
  if (!s.reasons.includes(reason)) throw new HttpError(`Select a write-off reason (${s.reasons.join(', ')})`, 400);
  if (s.noteReasons.includes(reason) && !String(note || '').trim()) throw new HttpError('Write-off reason "Other" needs a note', 400);
  return { writeOffAmount: round2(raw), writeOffReason: reason };
};

/**
 * Validasi murni body pembayaran tunggal -> { type, amount, method, date, note, writeOff } atau { error }.
 * amount boleh 0 bila ada potongan; method DEPOSIT hanya untuk PAYMENT (deposit dicek di recordPayment).
 */
const parsePaymentInput = (side, body, methods) => {
  try {
    const type = body.type === 'REFUND' ? 'REFUND' : 'PAYMENT';
    const amountRaw = body.amount === undefined || body.amount === null || body.amount === '' ? 0 : body.amount;
    const amountErr = checkAmount(amountRaw, 'Amount', { min: 0 });
    if (amountErr) return { error: amountErr };
    const amount = round2(amountRaw);
    const note = String(body.note ?? '').trim().slice(0, 500);
    if (type === 'REFUND' && Number(body.writeOffAmount || 0)) return { error: 'Refunds cannot have a write-off' };
    const writeOff = type === 'PAYMENT' ? parseWriteOff(side, body, note) : { writeOffAmount: 0, writeOffReason: null };
    if (amount <= 0 && !writeOff.writeOffAmount) return { error: 'Enter an amount' };
    const method = amount > 0 ? body.method : null;
    if (amount > 0 && !methods.includes(method) && !(type === 'PAYMENT' && method === 'DEPOSIT')) return { error: 'Please select a payment method' };
    const date = body.date ? new Date(body.date) : new Date();
    if (Number.isNaN(date.getTime())) return { error: 'Invalid payment date' };
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    if (date > endOfToday) return { error: 'Payment date cannot be in the future' };
    return { type, amount, method, date, note, writeOff };
  } catch (err) {
    return { error: err.message };
  }
};

/** Batas potongan tanpa persetujuan (setting) & izin approve. limitCache: hasil getSettings bila sudah dibaca. */
const assertWriteOffAllowed = async (req, side, writeOffAmount, writeOffReason, settings = null) => {
  if (!writeOffAmount) return;
  const s = SIDES[side];
  if (hasPermission(req.user, s.resource, 'approve')) return;
  if (s.approvalReasons.includes(writeOffReason)) {
    throw new HttpError('Writing off a bad debt needs the Approve permission on payments', 403);
  }
  const limit = Number((settings || (await getSettings()))['payment.writeOffLimit'] ?? 0);
  if (writeOffAmount > limit) {
    throw new HttpError(`Write-off ${fmt(writeOffAmount)} is above the limit ${fmt(limit)}; it needs the Approve permission on payments`, 403);
  }
};

/** Ubah dibayar / potongan invoice + status bayar */
const applyToInvoice = (inv, paid, writeOff = 0) => {
  inv.paidAmount = round2((inv.paidAmount || 0) + paid);
  if (writeOff) inv.writtenOffAmount = round2((inv.writtenOffAmount || 0) + writeOff);
  inv.paymentStatus = invoiceBalance(inv).paymentStatus;
};

/** Deposit milik pihak tsb yang masih bersaldo >= amount (dikunci lewat penulisan dokumen deposit) */
const loadDepositFor = async (side, depositId, partyId, amount) => {
  const s = SIDES[side];
  if (!mongoose.isValidObjectId(depositId)) throw new HttpError('Select a deposit to pay from', 400);
  const dep = await model(s.Deposit).findById(depositId);
  if (!dep) throw new HttpError('Deposit not found', 404);
  if (String(dep[s.partyField]) !== String(partyId)) throw new HttpError(`${dep.no} belongs to another ${s.partyField}`, 400);
  if (dep.status !== 'POSTED') throw new HttpError(`${dep.no} is cancelled`, 400);
  const bal = depositBalance(dep);
  if (amount > bal) throw new HttpError(`${dep.no}: ${fmt(amount)} exceeds the deposit balance ${fmt(bal)}`, 400);
  return dep;
};

/**
 * Catat 1 pembayaran PAYMENT untuk invoice (uang / deposit + potongan). inv = dokumen mongoose (sudah dikunci & dicek
 * akses oleh pemanggil). opts: { date, method, amount, writeOffAmount, writeOffReason, depositId, reference, note,
 * batch, extra, batchId }. -> { payment, deposit }
 */
const recordPayment = async (req, side, inv, opts) => {
  const s = SIDES[side];
  const amount = round2(opts.amount || 0);
  const writeOff = round2(opts.writeOffAmount || 0);
  if (inv.status !== 'POSTED') throw new HttpError(`${inv.no} is not posted`, 400);
  if (amount <= 0 && writeOff <= 0) throw new HttpError('Enter an amount or a write-off', 400);
  const { balance } = invoiceBalance(inv);
  if (balance <= 0) throw new HttpError(`${inv.no} has nothing left to pay`, 400);
  if (round2(amount + writeOff) > balance) {
    throw new HttpError(`${inv.no}: ${fmt(amount + writeOff)} (payment + write-off) exceeds the outstanding balance ${fmt(balance)}`, 400);
  }
  let deposit = null;
  let depBefore = null;
  if (amount > 0 && opts.method === 'DEPOSIT') {
    deposit = await loadDepositFor(side, opts.depositId, inv[s.partyField], amount);
    depBefore = await audit.snap(s.depositEntity, [deposit]);
    deposit.usedAmount = round2((deposit.usedAmount || 0) + amount);
    await deposit.save();
  }
  const payment = await model(s.Payment).create({
    no: await nextDocNo(s.payPrefix),
    type: 'PAYMENT',
    [s.invoiceField]: inv._id,
    [s.partyField]: inv[s.partyField],
    ...(opts.extra || {}),
    batch: opts.batch || null,
    deposit: deposit?._id || null,
    date: opts.date,
    method: amount > 0 ? opts.method : null,
    amount,
    writeOffAmount: writeOff,
    writeOffReason: writeOff ? opts.writeOffReason : null,
    reference: opts.reference || '',
    note: opts.note || '',
    createdBy: req.user._id,
  });
  const invBefore = await audit.snap(s.invoiceEntity, [inv]);
  applyToInvoice(inv, amount, writeOff);
  await inv.save();
  const o = { batchId: opts.batchId };
  await audit.logCreate(req, s.paymentEntity, [payment], o);
  await audit.logUpdate(req, s.invoiceEntity, invBefore, [inv], o);
  if (deposit) await audit.logUpdate(req, s.depositEntity, depBefore, [deposit], o);
  return { payment, deposit };
};

/**
 * Batalkan 1 pembayaran (PAYMENT / REFUND): invoice dihitung ulang, deposit yang dipakai dikembalikan saldonya.
 * Invoice dikunci di sini. -> payment
 */
const reversePayment = async (req, side, payment, reason, { batchId } = {}) => {
  const s = SIDES[side];
  await lock(ref(s.invoiceEntity, payment[s.invoiceField]));
  const inv = await model(s.Invoice).findById(payment[s.invoiceField]);
  const before = await audit.snap(s.paymentEntity, [payment]);
  Object.assign(payment, { status: 'CANCELLED', cancelReason: reason, cancelledBy: req.user._id, cancelledDate: new Date() });
  await payment.save();
  await audit.logUpdate(req, s.paymentEntity, before, [payment], { batchId });
  if (inv && inv.status === 'POSTED') {
    const iBefore = await audit.snap(s.invoiceEntity, [inv]);
    applyToInvoice(inv, payment.type === 'REFUND' ? payment.amount : -payment.amount, -(payment.writeOffAmount || 0));
    await inv.save();
    await audit.logUpdate(req, s.invoiceEntity, iBefore, [inv], { batchId });
  }
  if (payment.type === 'PAYMENT' && payment.method === 'DEPOSIT' && payment.deposit) {
    const dep = await model(s.Deposit).findById(payment.deposit);
    if (dep) {
      const dBefore = await audit.snap(s.depositEntity, [dep]);
      dep.usedAmount = round2(Math.max(0, (dep.usedAmount || 0) - payment.amount));
      await dep.save();
      await audit.logUpdate(req, s.depositEntity, dBefore, [dep], { batchId });
    }
  }
  return payment;
};

/** Saldo deposit per pihak (POSTED) -> Map(partyId -> saldo) */
const depositBalances = async (side, partyIds = null) => {
  const s = SIDES[side];
  const match = { status: 'POSTED' };
  if (partyIds) match[s.partyField] = { $in: partyIds.map((id) => new mongoose.Types.ObjectId(String(id))) };
  const rows = await model(s.Deposit).aggregate([
    { $match: match },
    { $group: { _id: `$${s.partyField}`, bal: { $sum: { $subtract: ['$amount', { $add: [{ $ifNull: ['$usedAmount', 0] }, { $ifNull: ['$refundedAmount', 0] }, { $ifNull: ['$writtenOffAmount', 0] }] }] } } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), round2(r.bal)]));
};

module.exports = {
  SIDES, parseWriteOff, parsePaymentInput, assertWriteOffAllowed, applyToInvoice, loadDepositFor, recordPayment, reversePayment, depositBalances,
};
