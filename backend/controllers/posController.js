const mongoose = require('mongoose');
const Outlet = require('../models/Outlet');
const PosShift = require('../models/PosShift');
const SalesInvoice = require('../models/SalesInvoice');
const SalesPayment = require('../models/SalesPayment');
const Customer = require('../models/Customer');
const ProdukSku = require('../models/ProdukSku');
const Produk = require('../models/Produk');
const Gudang = require('../models/Gudang');
const { hasPermission } = require('../config/permissions');
const { successResponse, errorResponse } = require('../helpers/responseHelper');
const audit = require('../helpers/auditLogger');
const { runInTransaction, HttpError, lock, ref } = require('../helpers/transaction');
const { applyMovements, getBalances, nextDocNo } = require('../helpers/stockHelper');
const { getSettings } = require('../helpers/settings');
const { checkAmount, round2 } = require('../helpers/number');
const { salesLineSubtotal, salesTotals, invoiceBalance } = require('../helpers/salesHelper');
const { resolvePrices } = require('../helpers/priceHelper');
const { canUseOutlet, assertOutlet, shiftSummary } = require('../helpers/posHelper');
const PosHold = require('../models/PosHold');
const SalesReturn = require('../models/SalesReturn');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const { createPostedReturn, returnable } = require('./salesReturnController');
const { returnLineValues } = require('../helpers/salesHelper');

const MAX_HOLDS = 10;
const PIN_MAX_FAILED = 5;
const PIN_LOCK_MINUTES = 15;
const { MAX_LINES } = require('../config/stock');

const METHODS = ['CASH', 'CARD', 'QRIS', 'TRANSFER', 'OTHER'];

const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status);
  if (error.code === 11000) return errorResponse(res, 'You already have an open shift', 400);
  if (error.name === 'ValidationError' || error.name === 'CastError') return errorResponse(res, error.message, 400);
  return errorResponse(res, error.message, 500);
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const trimText = (v, max = 500) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));
const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

const populateShift = (q) => q
  .populate('outlet', 'code name gudang priceIncludesTax receiptHeader receiptFooter receiptWidth autoPrint alamat kota phone isActive')
  .populate('gudang', 'code name')
  .populate('cashier', 'name');

/** Shift OPEN milik user (tanpa throw) */
const myOpenShift = (req) => PosShift.findOne({ cashier: req.user._id, status: 'OPEN' });

/** Shift OPEN milik user, dikunci (bentrok dengan transaksi / tutup shift lain) */
const requireMyShift = async (req) => {
  const shift = await myOpenShift(req);
  if (!shift) throw new HttpError('Open a shift first', 400);
  await lock(ref('posShift', shift._id));
  return shift;
};

/** Ringkasan + 10 transaksi terakhir shift */
const shiftView = async (shift) => {
  const summary = await shiftSummary(shift);
  const recent = await SalesInvoice.find({ shift: shift._id })
    .select('no date total status customer change')
    .populate('customer', 'name')
    .sort({ date: -1, _id: -1 })
    .limit(10)
    .lean();
  return { ...shift, summary, recent };
};

// ---------------------------------------------------------------- konteks & shift

/**
 * GET /api/pos/context — data layar kasir: outlet yang boleh dipakai (aktif), shift OPEN milik user
 * (+ ringkasan), customer walk-in, tarif PPN.
 */
exports.getContext = async (req, res) => {
  try {
    const outlets = (await Outlet.find({ isActive: true }).select('code name gudang priceIncludesTax').populate('gudang', 'code name').sort({ name: 1 }).lean())
      .filter((o) => canUseOutlet(req, o._id));
    const shift = await populateShift(myOpenShift(req)).lean();
    const settings = await getSettings();
    const walkIn = await Customer.findOne({ isWalkIn: true }).select('code name').lean();
    return successResponse(res, {
      outlets,
      shift: shift ? { ...(await shiftView(shift)), holdCount: await PosHold.countDocuments({ shift: shift._id }) } : null,
      walkIn,
      taxRate: settings['tax.isPKP'] !== false ? (settings['tax.ppnRate'] ?? 0) : 0,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

/** POST /api/pos/shift/open { outlet, openingCash } — maks. 1 shift OPEN per kasir */
exports.openShift = async (req, res) => {
  try {
    const { outlet: outletId } = req.body;
    if (!mongoose.isValidObjectId(outletId)) return errorResponse(res, 'Please select an outlet', 400);
    const err = checkAmount(req.body.openingCash ?? 0, 'Opening cash');
    if (err) return errorResponse(res, err, 400);
    assertOutlet(req, outletId);

    const shift = await runInTransaction(async () => {
      await lock(ref('outlet', outletId), `posCashier:${req.user._id}`);
      if (await PosShift.exists({ cashier: req.user._id, status: 'OPEN' })) throw new HttpError('You already have an open shift. Close it first.', 400);
      const outlet = await Outlet.findById(outletId).select('code gudang isActive').lean();
      if (!outlet) throw new HttpError('Outlet not found', 404);
      if (outlet.isActive === false) throw new HttpError(`Outlet ${outlet.code} is inactive`, 400);
      await lock(ref('gudang', outlet.gudang));
      const g = await Gudang.findById(outlet.gudang).select('code isActive').lean();
      if (!g || g.isActive === false) throw new HttpError('The warehouse of this outlet is inactive', 400);
      const shift = await PosShift.create({
        no: await nextDocNo('SHF'),
        outlet: outlet._id,
        gudang: outlet.gudang,
        cashier: req.user._id,
        openingCash: round2(req.body.openingCash ?? 0),
        createdBy: req.user._id,
      });
      await audit.logCreate(req, 'posShift', [shift]);
      return shift;
    });
    return successResponse(res, shift, `Shift ${shift.no} opened`, 201);
  } catch (error) {
    return handleError(res, error);
  }
};

/** POST /api/pos/shift/cash { type: IN|OUT, amount, reason } — kas masuk / keluar laci (keluar <= kas seharusnya) */
exports.cashMove = async (req, res) => {
  try {
    const type = req.body.type === 'OUT' ? 'OUT' : req.body.type === 'IN' ? 'IN' : null;
    if (!type) return errorResponse(res, 'Type must be IN or OUT', 400);
    const err = checkAmount(req.body.amount, 'Amount', { min: 0, exclusive: true });
    if (err) return errorResponse(res, err, 400);
    const reason = trimText(req.body.reason, 200);
    if (!reason) return errorResponse(res, 'Reason is required', 400);
    const amount = round2(req.body.amount);

    const shift = await runInTransaction(async () => {
      const shift = await requireMyShift(req);
      if (type === 'OUT') {
        const { expectedCash } = await shiftSummary(shift);
        if (amount > expectedCash) throw new HttpError(`Cash in drawer is only ${fmt(expectedCash)}`, 400);
      }
      const before = await audit.snap('posShift', [shift]);
      shift.cashMoves.push({ type, amount, reason, by: req.user._id, date: new Date() });
      shift.updatedDate = new Date();
      shift.updatedBy = req.user._id;
      await shift.save();
      await audit.logUpdate(req, 'posShift', before, [shift]);
      return shift;
    });
    return successResponse(res, shift, type === 'IN' ? 'Cash in recorded' : 'Cash out recorded');
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * Tutup shift: closingCash = uang fisik, selisih = closing - seharusnya (catatan wajib bila ada selisih).
 * Dipakai kasir (shift sendiri) & supervisor (posShift:update, shift kasir lain).
 */
const closeShiftDoc = async (req, shift) => {
  const err = checkAmount(req.body.closingCash, 'Counted cash');
  if (err) throw new HttpError(err, 400);
  const note = trimText(req.body.note);
  const summary = await shiftSummary(shift);
  const closingCash = round2(req.body.closingCash);
  const difference = round2(closingCash - summary.expectedCash);
  if (difference !== 0 && !note) throw new HttpError(`Cash difference ${fmt(difference)}: explain it in the note`, 400);
  const before = await audit.snap('posShift', [shift]);
  Object.assign(shift, {
    status: 'CLOSED',
    closedAt: new Date(),
    closingCash,
    expectedCash: summary.expectedCash,
    difference,
    closeNote: note,
    salesCount: summary.salesCount,
    salesTotal: summary.salesTotal,
    updatedDate: new Date(),
    updatedBy: req.user._id,
  });
  await shift.save();
  await PosHold.deleteMany({ shift: shift._id }); // transaksi ditahan yang tersisa dibuang
  await audit.logUpdate(req, 'posShift', before, [shift]);
  return shift;
};

/** POST /api/pos/shift/close { closingCash, note } — tutup shift sendiri */
exports.closeShift = async (req, res) => {
  try {
    const shift = await runInTransaction(async () => closeShiftDoc(req, await requireMyShift(req)));
    return successResponse(res, shift, `Shift ${shift.no} closed`);
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- SKU

/**
 * GET /api/pos/skus?search=&customer= — SKU aktif untuk keranjang (gudang shift): harga (price list
 * customer / default), saldo, barcode. Barcode / kode SKU yang sama persis = `exact` (urutan pertama).
 */
exports.searchSkus = async (req, res) => {
  try {
    const shift = await myOpenShift(req).lean();
    if (!shift) return errorResponse(res, 'Open a shift first', 400);
    const q = String(req.query.search || '').trim();
    if (!q) return successResponse(res, []);
    const rx = { $regex: escapeRegex(q), $options: 'i' };
    const produkIds = await Produk.find({ name: rx }).distinct('_id');
    const select = 'sku barcode produk variantValues hargaJual';
    const populate = { path: 'produk', select: 'name uom', populate: { path: 'uom', select: 'code' } };
    const exact = await ProdukSku.find({ isActive: true, $or: [{ barcode: q }, { sku: q.toUpperCase() }] }).select(select).populate(populate).lean();
    const others = await ProdukSku.find({ isActive: true, _id: { $nin: exact.map((s) => s._id) }, $or: [{ sku: rx }, { barcode: rx }, { produk: { $in: produkIds } }] })
      .select(select).populate(populate).sort({ sku: 1 }).limit(20).lean();
    const skus = [...exact, ...others];
    const ids = skus.map((s) => s._id);
    const [balances, prices] = await Promise.all([getBalances(shift.gudang, ids), resolvePrices(req.query.customer, ids)]);
    const exactIds = new Set(exact.map((s) => String(s._id)));
    return successResponse(res, skus.map((s) => ({
      _id: s._id,
      sku: s.sku,
      barcode: s.barcode || '',
      exact: exactIds.has(String(s._id)),
      variant: (s.variantValues || []).map((v) => v.value).join(' / ') || 'Default',
      produk: s.produk ? { _id: s.produk._id, name: s.produk.name } : null,
      uom: s.produk?.uom?.code || '',
      qty: balances.get(String(s._id)) || 0,
      price: prices.get(String(s._id))?.price ?? s.hargaJual ?? 0,
      priceSource: prices.get(String(s._id))?.source || 'default',
    })));
  } catch (error) {
    return handleError(res, error);
  }
};

/** POST /api/pos/prices { customer, skus } -> { skuId: { price, source } } (ganti customer di keranjang) */
exports.prices = async (req, res) => {
  try {
    const ids = (Array.isArray(req.body.skus) ? req.body.skus : []).filter((id) => mongoose.isValidObjectId(id));
    if (ids.length > MAX_LINES) return errorResponse(res, `At most ${MAX_LINES} SKUs`, 400);
    const prices = await resolvePrices(req.body.customer, ids);
    return successResponse(res, Object.fromEntries([...prices.entries()].map(([id, p]) => [id, { price: p.price, source: p.source }])));
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- transaksi

/**
 * POST /api/pos/sales — penjualan POS (langsung POSTED & lunas) di shift OPEN milik kasir.
 * body: { customer?, lines: [{ sku, qty, diskonPersen?, note? }], discountAmount?, payments: [{ method, amount, reference? }], note? }
 * - harga dibekukan (price list customer / harga jual SKU); PPN: tarif setting, termasuk/tidak = outlet
 * - pembayaran boleh split; non-tunai <= total; total bayar >= total; kembalian hanya dari tunai
 * - stok keluar (SALE) dari gudang outlet; stok kurang -> seluruh transaksi batal
 */
exports.createSale = async (req, res) => {
  try {
    const input = Array.isArray(req.body.lines) ? req.body.lines : [];
    if (!input.length) return errorResponse(res, 'Cart is empty', 400);
    if (input.length > MAX_LINES) return errorResponse(res, `At most ${MAX_LINES} lines`, 400);
    const seen = new Set();
    const lines = [];
    for (const [i, l] of input.entries()) {
      const n = `Line ${i + 1}`;
      if (!mongoose.isValidObjectId(l?.sku)) return errorResponse(res, `${n}: invalid SKU`, 400);
      if (seen.has(String(l.sku))) return errorResponse(res, `${n}: the same SKU appears more than once`, 400);
      seen.add(String(l.sku));
      const e = checkAmount(l.qty, 'Quantity', { min: 0, exclusive: true }) || checkAmount(l.diskonPersen ?? 0, 'Discount');
      if (e) return errorResponse(res, `${n}: ${e}`, 400);
      if (Number(l.diskonPersen || 0) > 100) return errorResponse(res, `${n}: Discount must be <= 100`, 400);
      lines.push({ sku: String(l.sku), qty: round2(l.qty), diskonPersen: round2(l.diskonPersen ?? 0), unitCost: null, note: trimText(l.note, 200) || undefined });
    }
    const discErr = checkAmount(req.body.discountAmount ?? 0, 'Discount');
    if (discErr) return errorResponse(res, discErr, 400);
    const pays = (Array.isArray(req.body.payments) ? req.body.payments : []).filter((p) => Number(p?.amount) !== 0);
    if (!pays.length) return errorResponse(res, 'Add a payment', 400);
    for (const p of pays) {
      if (!METHODS.includes(p.method)) return errorResponse(res, 'Invalid payment method', 400);
      const e = checkAmount(p.amount, 'Payment amount', { min: 0, exclusive: true });
      if (e) return errorResponse(res, e, 400);
    }

    const doc = await runInTransaction(async () => {
      const shift = await requireMyShift(req);
      const outlet = await Outlet.findById(shift.outlet).select('code isActive priceIncludesTax').lean();
      if (!outlet || outlet.isActive === false) throw new HttpError('Outlet is inactive', 400);

      // customer: default walk-in
      let customerId = req.body.customer;
      if (!customerId) customerId = (await Customer.findOne({ isWalkIn: true }).select('_id').lean())?._id;
      if (!customerId || !mongoose.isValidObjectId(customerId)) throw new HttpError('Please select a customer', 400);
      await lock(ref('customer', customerId), ref('gudang', shift.gudang));
      const customer = await Customer.findById(customerId).select('name isActive').lean();
      if (!customer) throw new HttpError('Customer not found', 400);
      if (customer.isActive === false) throw new HttpError(`Customer ${customer.name} is inactive`, 400);

      // SKU aktif + produk (dikunci: bentrok dengan hapus produk)
      const skus = await ProdukSku.find({ _id: { $in: lines.map((l) => l.sku) } }).select('sku produk isActive').lean();
      if (skus.length !== lines.length) throw new HttpError('One or more SKUs no longer exist', 400);
      const inactive = skus.find((s) => s.isActive === false);
      if (inactive) throw new HttpError(`${inactive.sku} is inactive and cannot be sold`, 400);
      await lock([...new Set(skus.map((s) => String(s.produk)))].map((id) => ref('produk', id)));
      const produkOf = new Map(skus.map((s) => [String(s._id), s.produk]));

      // harga dibekukan
      const prices = await resolvePrices(customerId, lines.map((l) => l.sku));
      lines.forEach((l) => {
        l.produk = produkOf.get(l.sku);
        l.hargaJual = round2(prices.get(l.sku)?.price ?? 0);
        l.subtotal = salesLineSubtotal(l);
      });
      const settings = await getSettings();
      const taxRate = settings['tax.isPKP'] !== false ? (settings['tax.ppnRate'] ?? 0) : 0;
      const subtotal = round2(lines.reduce((s, l) => s + l.subtotal, 0));
      const discountAmount = round2(req.body.discountAmount ?? 0);
      if (discountAmount > subtotal) throw new HttpError('Discount cannot exceed the subtotal', 400);
      const totals = salesTotals(lines, { discountAmount, taxRate, priceIncludesTax: outlet.priceIncludesTax !== false });

      // pembayaran: kembalian hanya dari tunai
      const cashGiven = round2(pays.filter((p) => p.method === 'CASH').reduce((s, p) => s + Number(p.amount), 0));
      const nonCash = round2(pays.filter((p) => p.method !== 'CASH').reduce((s, p) => s + Number(p.amount), 0));
      if (nonCash > totals.total) throw new HttpError('Non-cash payments cannot exceed the total', 400);
      if (round2(cashGiven + nonCash) < totals.total) {
        throw new HttpError(`Payment ${fmt(cashGiven + nonCash)} is less than the total ${fmt(totals.total)}`, 400);
      }
      const change = round2(cashGiven + nonCash - totals.total);

      const now = new Date();
      const doc = new SalesInvoice({
        no: await nextDocNo('POS'),
        source: 'POS',
        outlet: outlet._id,
        shift: shift._id,
        customer: customerId,
        gudang: shift.gudang,
        date: now,
        dueDate: now,
        status: 'DRAFT',
        taxRate,
        priceIncludesTax: outlet.priceIncludesTax !== false,
        lines,
        ...totals,
        note: trimText(req.body.note),
        cashTendered: cashGiven || null,
        change: cashGiven ? change : null,
        createdBy: req.user._id,
      });

      const movements = await applyMovements(req, lines.map((l) => ({
        sku: l.sku, gudang: shift.gudang, qty: -l.qty, type: 'SALE', note: l.note,
      })), { refType: 'SalesInvoice', refId: doc._id, refNo: doc.no });
      const costOf = new Map(movements.map((m) => [String(m.sku), m.unitCost ?? null]));
      doc.lines.forEach((l) => { l.unitCost = costOf.get(String(l.sku)) ?? null; });
      doc.cogs = round2(doc.lines.reduce((s, l) => s + l.qty * (l.unitCost || 0), 0));
      doc.status = 'POSTED';
      doc.postedBy = req.user._id;
      doc.postedDate = now;
      doc.returnedAmount = 0;
      doc.paidAmount = totals.total;
      doc.paymentStatus = invoiceBalance(doc).paymentStatus;
      await doc.save();

      // pembayaran per metode (tunai dicatat bersih setelah kembalian)
      const byMethod = new Map();
      pays.forEach((p) => {
        const cur = byMethod.get(p.method) || { amount: 0, reference: [] };
        cur.amount = round2(cur.amount + Number(p.amount));
        if (p.reference) cur.reference.push(trimText(p.reference, 100));
        byMethod.set(p.method, cur);
      });
      if (byMethod.has('CASH')) byMethod.get('CASH').amount = round2(cashGiven - change);
      const payments = [];
      for (const [method, p] of byMethod) {
        if (p.amount <= 0) continue;
        payments.push(await SalesPayment.create({
          no: await nextDocNo('PAY'),
          type: 'PAYMENT',
          salesInvoice: doc._id,
          customer: customerId,
          gudang: shift.gudang,
          shift: shift._id,
          date: now,
          method,
          amount: p.amount,
          reference: p.reference.join(', ').slice(0, 100),
          createdBy: req.user._id,
        }));
      }
      await audit.logCreate(req, 'salesInvoice', [doc]);
      await audit.logCreate(req, 'salesPayment', payments);
      return doc;
    });
    return successResponse(res, { _id: doc._id, no: doc.no, total: doc.total, change: doc.change }, `${doc.no} saved`, 201);
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * GET /api/pos/sales/:id/receipt — data struk: outlet (header/footer/lebar), baris, total, pembayaran,
 * kasir. Boleh: kasir yang ditugaskan di outlet tsb atau pemegang izin salesInvoice:view.
 */
exports.getReceipt = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 'Sale not found', 404);
    const inv = await SalesInvoice.findById(req.params.id)
      .select('no date source outlet customer lines subtotal discountAmount dpp taxAmount taxRate priceIncludesTax total cashTendered change status createdBy')
      .populate('outlet', 'code name alamat kota phone receiptHeader receiptFooter receiptWidth')
      .populate('customer', 'name isWalkIn')
      .populate('lines.sku', 'sku variantValues')
      .populate('lines.produk', 'name')
      .populate('createdBy', 'name')
      .lean();
    if (!inv || inv.source !== 'POS') return errorResponse(res, 'Sale not found', 404);
    if (!canUseOutlet(req, inv.outlet?._id) && !hasPermission(req.user, 'salesInvoice', 'view')) {
      return errorResponse(res, "You don't have access to this sale", 403);
    }
    inv.lines.forEach((l) => { delete l.unitCost; });
    inv.payments = await SalesPayment.find({ salesInvoice: inv._id, status: 'POSTED' }).select('method amount type reference').lean();
    return successResponse(res, inv);
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- persetujuan supervisor (PIN)

/**
 * Verifikasi PIN supervisor (di LUAR transaksi supaya hitungan salah PIN tidak ikut di-rollback).
 * Syarat: user aktif, izin pos:post, punya PIN, ditugaskan di outlet (Super Admin semua).
 * 5x salah berturut-turut -> PIN terkunci 15 menit.
 */
const verifyApprover = async (approverId, pin, outletId) => {
  if (!mongoose.isValidObjectId(approverId)) throw new HttpError('Choose the approving supervisor', 400);
  if (!pin) throw new HttpError('Supervisor PIN is required', 400);
  const u = await User.findById(approverId).select('+posPinHash +posPinFailed +posPinLockedUntil').populate('role');
  if (!u || u.isActive === false || !u.posPinHash || !hasPermission(u, 'pos', 'post')) {
    throw new HttpError('This user cannot approve POS actions', 403);
  }
  if (!u.role?.isSystem && !(u.outlets || []).some((id) => String(id) === String(outletId))) {
    throw new HttpError('Supervisor is not assigned to this outlet', 403);
  }
  const now = new Date();
  if (u.posPinLockedUntil && u.posPinLockedUntil > now) {
    const mins = Math.ceil((u.posPinLockedUntil - now) / 60000);
    throw new HttpError(`PIN locked after too many attempts. Try again in ${mins} minute(s).`, 429);
  }
  if (!(await bcrypt.compare(String(pin), u.posPinHash))) {
    const failed = (u.posPinFailed || 0) + 1;
    await User.updateOne({ _id: u._id }, failed >= PIN_MAX_FAILED
      ? { posPinFailed: 0, posPinLockedUntil: new Date(now.getTime() + PIN_LOCK_MINUTES * 60000) }
      : { posPinFailed: failed });
    throw new HttpError(failed >= PIN_MAX_FAILED ? `Wrong PIN. PIN locked for ${PIN_LOCK_MINUTES} minutes.` : 'Wrong PIN', 403);
  }
  if (u.posPinFailed || u.posPinLockedUntil) await User.updateOne({ _id: u._id }, { posPinFailed: 0, posPinLockedUntil: null });
  return { _id: u._id, name: u.name };
};

/** GET /api/pos/approvers — supervisor yang bisa menyetujui di outlet shift ini (izin pos:post + PIN) */
exports.getApprovers = async (req, res) => {
  try {
    const shift = await myOpenShift(req).lean();
    if (!shift) return errorResponse(res, 'Open a shift first', 400);
    const users = await User.find({ isActive: { $ne: false }, hasPosPin: true }).select('name outlets').populate('role').lean();
    return successResponse(res, users
      .filter((u) => hasPermission(u, 'pos', 'post') && (u.role?.isSystem || (u.outlets || []).some((id) => String(id) === String(shift.outlet))))
      .map((u) => ({ _id: u._id, name: u.name }))
      .sort((a, b) => a.name.localeCompare(b.name)));
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- hold / park

/** GET /api/pos/holds — transaksi ditahan di shift sendiri */
exports.getHolds = async (req, res) => {
  try {
    const shift = await myOpenShift(req).lean();
    if (!shift) return successResponse(res, []);
    const holds = await PosHold.find({ shift: shift._id }).populate('customer', 'name').sort({ createdDate: 1 }).lean();
    return successResponse(res, holds.map((h) => ({
      _id: h._id, note: h.note, customer: h.customer, createdDate: h.createdDate,
      itemCount: h.lines.length, qty: round2(h.lines.reduce((s, l) => s + l.qty, 0)),
    })));
  } catch (error) {
    return handleError(res, error);
  }
};

/** POST /api/pos/holds { customer, lines: [{ sku, qty, diskonPersen }], discountAmount, note } — maks. 10 per shift */
exports.createHold = async (req, res) => {
  try {
    const input = Array.isArray(req.body.lines) ? req.body.lines : [];
    if (!input.length) return errorResponse(res, 'Cart is empty', 400);
    const lines = [];
    for (const l of input) {
      if (!mongoose.isValidObjectId(l?.sku)) return errorResponse(res, 'Invalid SKU', 400);
      const e = checkAmount(l.qty, 'Quantity', { min: 0, exclusive: true }) || checkAmount(l.diskonPersen ?? 0, 'Discount');
      if (e) return errorResponse(res, e, 400);
      lines.push({ sku: l.sku, qty: round2(l.qty), diskonPersen: Math.min(round2(l.diskonPersen ?? 0), 100) });
    }
    const hold = await runInTransaction(async () => {
      const shift = await requireMyShift(req);
      if ((await PosHold.countDocuments({ shift: shift._id })) >= MAX_HOLDS) throw new HttpError(`At most ${MAX_HOLDS} held transactions per shift`, 400);
      return PosHold.create({
        shift: shift._id, outlet: shift.outlet, cashier: req.user._id,
        customer: mongoose.isValidObjectId(req.body.customer) ? req.body.customer : null,
        note: trimText(req.body.note, 100), lines,
        discountAmount: round2(Number(req.body.discountAmount) || 0),
      });
    });
    return successResponse(res, hold, 'Transaction held', 201);
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * POST /api/pos/holds/:id/resume — isi keranjang (harga & stok terbaru) lalu hold dihapus.
 * SKU yang sudah tidak ada / nonaktif dilewati (dilaporkan di `skipped`).
 */
exports.resumeHold = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 'Held transaction not found', 404);
    const result = await runInTransaction(async () => {
      const shift = await requireMyShift(req);
      const hold = await PosHold.findOne({ _id: req.params.id, shift: shift._id });
      if (!hold) throw new HttpError('Held transaction not found', 404);
      const skus = await ProdukSku.find({ _id: { $in: hold.lines.map((l) => l.sku) }, isActive: true })
        .select('sku produk variantValues hargaJual')
        .populate({ path: 'produk', select: 'name uom', populate: { path: 'uom', select: 'code' } })
        .lean();
      const skuMap = new Map(skus.map((s) => [String(s._id), s]));
      const ids = skus.map((s) => s._id);
      const [balances, prices] = await Promise.all([getBalances(shift.gudang, ids), resolvePrices(hold.customer, ids)]);
      const lines = [];
      let skipped = 0;
      for (const l of hold.lines) {
        const s = skuMap.get(String(l.sku));
        if (!s) { skipped++; continue; }
        lines.push({
          sku: s._id, code: s.sku, name: s.produk?.name || '', uom: s.produk?.uom?.code || '',
          variant: (s.variantValues || []).map((v) => v.value).join(' / ') || 'Default',
          stock: balances.get(String(s._id)) || 0,
          hargaJual: prices.get(String(s._id))?.price ?? s.hargaJual ?? 0,
          priceSource: prices.get(String(s._id))?.source || 'default',
          qty: l.qty, diskonPersen: l.diskonPersen || 0,
        });
      }
      await hold.deleteOne();
      return { customer: hold.customer, discountAmount: hold.discountAmount, note: hold.note, lines, skipped };
    });
    return successResponse(res, result);
  } catch (error) {
    return handleError(res, error);
  }
};

/** DELETE /api/pos/holds/:id — buang transaksi ditahan (kasir sendiri, tanpa persetujuan) */
exports.deleteHold = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 'Held transaction not found', 404);
    const shift = await myOpenShift(req).lean();
    if (!shift) return errorResponse(res, 'Open a shift first', 400);
    const r = await PosHold.deleteOne({ _id: req.params.id, shift: shift._id });
    if (!r.deletedCount) return errorResponse(res, 'Held transaction not found', 404);
    return successResponse(res, null, 'Held transaction discarded');
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- cari transaksi, void, retur

/**
 * GET /api/pos/sales/lookup?no= — transaksi POS di outlet shift ini (untuk void / retur):
 * baris + qty yang masih bisa diretur & nilai per unit, pembayaran, canVoid / canReturn.
 */
exports.lookupSale = async (req, res) => {
  try {
    const shift = await myOpenShift(req).lean();
    if (!shift) return errorResponse(res, 'Open a shift first', 400);
    const no = String(req.query.no || '').trim().toUpperCase();
    if (!no) return errorResponse(res, 'Enter the receipt number', 400);
    const inv = await SalesInvoice.findOne({ no, source: 'POS' })
      .select('no date status outlet shift customer lines subtotal dpp total paidAmount returnedAmount')
      .populate('customer', 'name')
      .populate('lines.sku', 'sku variantValues')
      .populate('lines.produk', 'name')
      .lean();
    if (!inv) return errorResponse(res, `Receipt ${no} not found`, 404);
    if (String(inv.outlet) !== String(shift.outlet)) return errorResponse(res, 'This receipt is from another outlet. Returns are only accepted at the outlet where it was bought.', 400);
    const returns = await SalesReturn.countDocuments({ salesInvoice: inv._id, status: { $in: ['DRAFT', 'POSTED'] } });
    inv.lines.forEach((l) => {
      l.returnable = returnable(l);
      l.unitAmount = returnLineValues(l, 1, inv).amount;
      l.variant = (l.sku?.variantValues || []).map((v) => v.value).join(' / ') || 'Default';
      delete l.unitCost;
    });
    inv.payments = await SalesPayment.find({ salesInvoice: inv._id, status: 'POSTED' }).select('method amount type').lean();
    inv.isCurrentShift = String(inv.shift) === String(shift._id);
    inv.canVoid = inv.status === 'POSTED' && inv.isCurrentShift && !returns;
    inv.canReturn = inv.status === 'POSTED' && inv.lines.some((l) => l.returnable > 0);
    return successResponse(res, inv);
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * POST /api/pos/sales/:id/void { reason, approver, pin } — batalkan transaksi di shift sendiri yang masih
 * terbuka, disetujui supervisor (PIN): stok kembali (pembalik SALE), pembayaran dibatalkan (kas seharusnya
 * berkurang). Transaksi yang sudah punya retur / dari shift lain -> pakai retur.
 */
exports.voidSale = async (req, res) => {
  try {
    const reason = trimText(req.body.reason);
    if (!reason) return errorResponse(res, 'Void reason is required', 400);
    if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 'Sale not found', 404);
    const mine = await myOpenShift(req).lean();
    if (!mine) return errorResponse(res, 'Open a shift first', 400);
    const approver = await verifyApprover(req.body.approver, req.body.pin, mine.outlet);

    const doc = await runInTransaction(async () => {
      const shift = await requireMyShift(req);
      await lock(ref('salesInvoice', req.params.id), ref('gudang', shift.gudang));
      const inv = await SalesInvoice.findById(req.params.id);
      if (!inv || inv.source !== 'POS') throw new HttpError('Sale not found', 404);
      if (inv.status !== 'POSTED') throw new HttpError('Sale is already cancelled', 400);
      if (String(inv.shift) !== String(shift._id)) throw new HttpError('Only sales in your open shift can be voided. Use a return instead.', 400);
      if (await SalesReturn.exists({ salesInvoice: inv._id, status: { $in: ['DRAFT', 'POSTED'] } })) {
        throw new HttpError('This sale already has a return. Use a return for the remaining items.', 400);
      }
      const note = `VOID: ${reason} (approved by ${approver.name})`;
      const before = await audit.snap('salesInvoice', [inv]);
      await applyMovements(req, inv.lines.map((l) => ({
        sku: l.sku, gudang: inv.gudang, qty: l.qty, unitCost: l.unitCost, type: 'SALE', note,
      })), { refType: 'SalesInvoice', refId: inv._id, refNo: inv.no, isReversal: true });

      const pays = await SalesPayment.find({ salesInvoice: inv._id, status: 'POSTED' });
      const payBefore = await audit.snap('salesPayment', pays);
      for (const p of pays) Object.assign(p, { status: 'CANCELLED', cancelledBy: req.user._id, cancelledDate: new Date(), cancelReason: note });
      for (const p of pays) await p.save();
      Object.assign(inv, {
        status: 'CANCELLED', paidAmount: 0, paymentStatus: null, cancelledBy: req.user._id, cancelledDate: new Date(),
        cancelReason: note, voidApprovedBy: approver._id,
      });
      await inv.save();
      await audit.logUpdate(req, 'salesPayment', payBefore, pays);
      await audit.logUpdate(req, 'salesInvoice', before, [inv]);
      return inv;
    });
    return successResponse(res, { _id: doc._id, no: doc.no, total: doc.total }, `${doc.no} voided`);
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * POST /api/pos/returns { salesInvoice, lines: [{ sku, qty }], reason, refundMethod, reference, approver, pin }
 * Retur di kasir (outlet yang sama dengan transaksi), disetujui supervisor (PIN): Sales Return POSTED
 * (stok masuk dengan HPP saat dijual) + refund sebesar kelebihan bayar dari laci shift ini
 * (tunai: tidak boleh melebihi kas di laci).
 */
exports.createReturn = async (req, res) => {
  try {
    const reason = trimText(req.body.reason);
    if (!reason) return errorResponse(res, 'Return reason is required', 400);
    if (!mongoose.isValidObjectId(req.body.salesInvoice)) return errorResponse(res, 'Sale not found', 404);
    const refundMethod = req.body.refundMethod || 'CASH';
    if (!METHODS.includes(refundMethod)) return errorResponse(res, 'Invalid refund method', 400);
    const seen = new Set();
    const lines = [];
    for (const l of (Array.isArray(req.body.lines) ? req.body.lines : [])) {
      if (!l || Number(l.qty) === 0 || l.qty === '' || l.qty === null || l.qty === undefined) continue;
      if (!mongoose.isValidObjectId(l.sku) || seen.has(String(l.sku))) return errorResponse(res, 'Invalid return lines', 400);
      seen.add(String(l.sku));
      const e = checkAmount(l.qty, 'Quantity', { min: 0, exclusive: true });
      if (e) return errorResponse(res, e, 400);
      lines.push({ sku: String(l.sku), qty: round2(l.qty) });
    }
    if (!lines.length) return errorResponse(res, 'Fill in the returned quantity for at least one item', 400);
    const mine = await myOpenShift(req).lean();
    if (!mine) return errorResponse(res, 'Open a shift first', 400);
    const approver = await verifyApprover(req.body.approver, req.body.pin, mine.outlet);

    const result = await runInTransaction(async () => {
      const shift = await requireMyShift(req);
      await lock(ref('salesInvoice', req.body.salesInvoice));
      const inv = await SalesInvoice.findById(req.body.salesInvoice);
      if (!inv || inv.source !== 'POS') throw new HttpError('Sale not found', 404);
      if (inv.status !== 'POSTED') throw new HttpError('Only completed sales can be returned', 400);
      if (String(inv.outlet) !== String(shift.outlet)) throw new HttpError('Returns are only accepted at the outlet where the item was bought', 400);

      const ret = await createPostedReturn(req, inv, {
        reason: `${reason} (approved by ${approver.name})`,
        lines,
        extra: { shift: shift._id, outlet: shift.outlet, approvedBy: approver._id },
      });

      // refund = kelebihan bayar setelah retur
      let refund = null;
      const { balance } = invoiceBalance(inv);
      if (balance < 0) {
        const amount = round2(-balance);
        if (refundMethod === 'CASH') {
          const { expectedCash } = await shiftSummary(shift);
          if (amount > expectedCash) throw new HttpError(`Cash in drawer (${fmt(expectedCash)}) is not enough for the refund ${fmt(amount)}`, 400);
        }
        const invBefore = await audit.snap('salesInvoice', [inv]);
        refund = await SalesPayment.create({
          no: await nextDocNo('RFD'), type: 'REFUND', salesInvoice: inv._id, customer: inv.customer, gudang: inv.gudang,
          shift: shift._id, date: new Date(), method: refundMethod, amount,
          reference: trimText(req.body.reference, 100), note: `Refund ${ret.no}`, createdBy: req.user._id,
        });
        inv.paidAmount = round2((inv.paidAmount || 0) - amount);
        inv.paymentStatus = invoiceBalance(inv).paymentStatus;
        await inv.save();
        await audit.logCreate(req, 'salesPayment', [refund]);
        await audit.logUpdate(req, 'salesInvoice', invBefore, [inv]);
      }
      return { returnNo: ret.no, returnId: ret._id, total: ret.total, refund: refund ? { no: refund.no, method: refund.method, amount: refund.amount } : null };
    });
    return successResponse(res, result, `${result.returnNo} posted`, 201);
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- daftar shift (supervisor)

/** GET /api/pos-shift — filter outlet, cashier, status, from, to (tanggal buka) */
exports.getShifts = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || 1) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || 10) || 10, 1), 100);
    const filter = {};
    for (const key of ['outlet', 'cashier']) {
      if (!req.query[key]) continue;
      if (!mongoose.isValidObjectId(req.query[key])) return errorResponse(res, `Invalid ${key}`, 400);
      filter[key] = req.query[key];
    }
    if (['OPEN', 'CLOSED'].includes(req.query.status)) filter.status = req.query.status;
    if (req.query.from || req.query.to) {
      filter.openedAt = {};
      if (req.query.from) filter.openedAt.$gte = new Date(`${req.query.from}T00:00:00`);
      if (req.query.to) filter.openedAt.$lte = new Date(`${req.query.to}T23:59:59.999`);
    }
    if (req.query.search) filter.no = { $regex: escapeRegex(req.query.search), $options: 'i' };
    const [totalData, docs] = await Promise.all([
      PosShift.countDocuments(filter),
      populateShift(PosShift.find(filter)).sort({ openedAt: -1, _id: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    ]);
    // shift OPEN: ringkasan berjalan
    for (const d of docs) {
      if (d.status === 'OPEN') {
        const s = await shiftSummary(d);
        Object.assign(d, { salesCount: s.salesCount, salesTotal: s.salesTotal, expectedCash: s.expectedCash });
      }
    }
    return successResponse(res, { dataPosShift: docs, totalData, currentPage: page, totalPages: Math.ceil(totalData / pageSize) });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * GET /api/pos-shift/report?from=&to=&outlet=&cashier= — ringkasan per kasir dari shift yang DIBUKA
 * pada periode: shift, transaksi, penjualan, rata-rata, per metode bayar (bersih), void, retur, selisih kas.
 */
exports.getCashierReport = async (req, res) => {
  try {
    const now = new Date();
    const from = req.query.from ? new Date(`${req.query.from}T00:00:00`) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = req.query.to ? new Date(`${req.query.to}T23:59:59.999`) : now;
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return errorResponse(res, 'Invalid date', 400);
    const filter = { openedAt: { $gte: from, $lte: to } };
    for (const key of ['outlet', 'cashier']) {
      if (!req.query[key]) continue;
      if (!mongoose.isValidObjectId(req.query[key])) return errorResponse(res, `Invalid ${key}`, 400);
      filter[key] = req.query[key];
    }
    const shifts = await PosShift.find(filter).select('cashier outlet status difference').populate('cashier', 'name').lean();
    const ids = shifts.map((s) => s._id);
    const [sales, voids, pays, rets] = await Promise.all([
      SalesInvoice.aggregate([{ $match: { shift: { $in: ids }, status: 'POSTED' } }, { $group: { _id: '$shift', count: { $sum: 1 }, total: { $sum: '$total' } } }]),
      SalesInvoice.aggregate([{ $match: { shift: { $in: ids }, status: 'CANCELLED', voidApprovedBy: { $ne: null } } }, { $group: { _id: '$shift', count: { $sum: 1 }, total: { $sum: '$total' } } }]),
      SalesPayment.aggregate([
        { $match: { shift: { $in: ids }, status: 'POSTED' } },
        { $group: { _id: { shift: '$shift', method: '$method' }, net: { $sum: { $cond: [{ $eq: ['$type', 'REFUND'] }, { $multiply: ['$amount', -1] }, '$amount'] } } } },
      ]),
      SalesReturn.aggregate([{ $match: { shift: { $in: ids }, status: 'POSTED' } }, { $group: { _id: '$shift', count: { $sum: 1 }, total: { $sum: '$total' } } }]),
    ]);
    const by = (list) => new Map(list.map((x) => [String(x._id), x]));
    const salesMap = by(sales);
    const voidMap = by(voids);
    const retMap = by(rets);
    const rows = new Map();
    const blank = (cashier) => ({
      cashier, shifts: 0, openShifts: 0, salesCount: 0, salesTotal: 0, byMethod: {},
      voidCount: 0, voidTotal: 0, returnCount: 0, returnTotal: 0, cashDifference: 0,
    });
    const shiftCashier = new Map();
    for (const s of shifts) {
      const key = String(s.cashier?._id);
      shiftCashier.set(String(s._id), key);
      if (!rows.has(key)) rows.set(key, blank({ _id: s.cashier?._id, name: s.cashier?.name || '(deleted)' }));
      const r = rows.get(key);
      r.shifts++;
      if (s.status === 'OPEN') r.openShifts++;
      r.cashDifference = round2(r.cashDifference + (s.difference || 0));
      const sl = salesMap.get(String(s._id));
      if (sl) { r.salesCount += sl.count; r.salesTotal = round2(r.salesTotal + sl.total); }
      const vd = voidMap.get(String(s._id));
      if (vd) { r.voidCount += vd.count; r.voidTotal = round2(r.voidTotal + vd.total); }
      const rt = retMap.get(String(s._id));
      if (rt) { r.returnCount += rt.count; r.returnTotal = round2(r.returnTotal + rt.total); }
    }
    for (const p of pays) {
      const r = rows.get(shiftCashier.get(String(p._id.shift)));
      if (r) r.byMethod[p._id.method] = round2((r.byMethod[p._id.method] || 0) + p.net);
    }
    const list = [...rows.values()].map((r) => ({ ...r, avgTicket: r.salesCount ? round2(r.salesTotal / r.salesCount) : 0 }))
      .sort((a, b) => b.salesTotal - a.salesTotal);
    const sum = (f) => round2(list.reduce((s, r) => s + r[f], 0));
    const totals = {
      shifts: sum('shifts'), salesCount: sum('salesCount'), salesTotal: sum('salesTotal'), voidCount: sum('voidCount'), voidTotal: sum('voidTotal'),
      returnCount: sum('returnCount'), returnTotal: sum('returnTotal'), cashDifference: sum('cashDifference'), byMethod: {},
    };
    list.forEach((r) => Object.entries(r.byMethod).forEach(([m, v]) => { totals.byMethod[m] = round2((totals.byMethod[m] || 0) + v); }));
    totals.avgTicket = totals.salesCount ? round2(totals.salesTotal / totals.salesCount) : 0;
    return successResponse(res, { from, to, rows: list, totals });
  } catch (error) {
    return handleError(res, error);
  }
};

/** GET /api/pos-shift/:id — shift + ringkasan + daftar transaksi */
exports.getShift = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 'Shift not found', 404);
    const shift = await populateShift(PosShift.findById(req.params.id)).populate('cashMoves.by', 'name').lean();
    if (!shift) return errorResponse(res, 'Shift not found', 404);
    shift.summary = await shiftSummary(shift);
    shift.sales = await SalesInvoice.find({ shift: shift._id })
      .select('no date total status customer change')
      .populate('customer', 'name')
      .sort({ date: 1 })
      .lean();
    return successResponse(res, shift);
  } catch (error) {
    return handleError(res, error);
  }
};

/** POST /api/pos-shift/:id/close { closingCash, note } — supervisor menutup shift kasir (posShift:update) */
exports.forceCloseShift = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 'Shift not found', 404);
    const shift = await runInTransaction(async () => {
      await lock(ref('posShift', req.params.id));
      const shift = await PosShift.findById(req.params.id);
      if (!shift) throw new HttpError('Shift not found', 404);
      if (shift.status !== 'OPEN') throw new HttpError('Shift is already closed', 400);
      return closeShiftDoc(req, shift);
    });
    return successResponse(res, shift, `Shift ${shift.no} closed`);
  } catch (error) {
    return handleError(res, error);
  }
};
