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
  .populate('outlet', 'code name gudang priceIncludesTax receiptHeader receiptFooter receiptWidth isActive')
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
      shift: shift ? await shiftView(shift) : null,
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
