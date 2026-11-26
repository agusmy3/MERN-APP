const mongoose = require('mongoose');
const SalesInvoice = require('../models/SalesInvoice');
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
const { salesLineSubtotal, salesTotals, netLineRevenue, invoiceBalance } = require('../helpers/salesHelper');
const SalesReturn = require('../models/SalesReturn');
const SalesPayment = require('../models/SalesPayment');
const DeliveryOrder = require('../models/DeliveryOrder');
const { resolvePrices } = require('../helpers/priceHelper');

const DAY = 24 * 60 * 60 * 1000;
const PAYMENT_FILTERS = ['UNPAID', 'PARTIAL', 'PAID', 'OVERPAID', 'OPEN', 'OVERDUE'];
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
const { assertGudang, applyGudangFilter } = require('../helpers/gudangAccess');
const { MAX_LINES } = require('../config/stock');

const STATUSES = ['DRAFT', 'POSTED', 'CANCELLED'];
const SORTABLE_FIELDS = ['no', 'date', 'total', 'createdDate', 'updatedDate', 'postedDate'];

const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status);
  if (error.name === 'ValidationError' || error.name === 'CastError') return errorResponse(res, error.message, 400);
  return errorResponse(res, error.message, 500);
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const trimText = (v, max = 500) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));
const canSeeCostOf = (req) => hasPermission(req.user, 'vendorPrice', 'view');

/** Validasi isi dokumen dari body (murni). Pajak: undefined = pakai System Settings. */
const parseInvoice = (body) => {
  if (!mongoose.isValidObjectId(body.customer)) throw new HttpError('Please select a customer', 400);
  if (!mongoose.isValidObjectId(body.gudang)) throw new HttpError('Please select a warehouse', 400);

  const date = body.date ? new Date(body.date) : new Date();
  if (Number.isNaN(date.getTime())) throw new HttpError('Invalid invoice date', 400);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  if (date > endOfToday) throw new HttpError('Invoice date cannot be in the future', 400);

  let taxRate;
  if (body.taxRate !== undefined && body.taxRate !== null && body.taxRate !== '') {
    const err = checkAmount(body.taxRate, 'Tax rate');
    if (err) throw new HttpError(err, 400);
    taxRate = round2(body.taxRate);
    if (taxRate > 100) throw new HttpError('Tax rate must be <= 100', 400);
  }
  const priceIncludesTax = body.priceIncludesTax === undefined || body.priceIncludesTax === null
    ? undefined : body.priceIncludesTax === true;

  const discountAmount = body.discountAmount === undefined || body.discountAmount === null || body.discountAmount === ''
    ? 0 : body.discountAmount;
  const discErr = checkAmount(discountAmount, 'Document discount');
  if (discErr) throw new HttpError(discErr, 400);

  const input = Array.isArray(body.lines) ? body.lines : [];
  if (!input.length) throw new HttpError('Add at least one item', 400);
  if (input.length > MAX_LINES) throw new HttpError(`An invoice can have at most ${MAX_LINES} lines`, 400);

  const seen = new Set();
  const lines = input.map((l, i) => {
    const n = `Line ${i + 1}`;
    if (!mongoose.isValidObjectId(l?.sku)) throw new HttpError(`${n}: invalid SKU`, 400);
    if (seen.has(String(l.sku))) throw new HttpError(`${n}: the same SKU appears more than once`, 400);
    seen.add(String(l.sku));
    // harga TIDAK diambil dari input (dibekukan): diisi applyPrices dari price list / harga default
    const err = checkAmount(l.qty, 'Quantity', { min: 0, exclusive: true })
      || checkAmount(l.diskonPersen ?? 0, 'Discount');
    if (err) throw new HttpError(`${n}: ${err}`, 400);
    const diskonPersen = round2(l.diskonPersen ?? 0);
    if (diskonPersen > 100) throw new HttpError(`${n}: Discount must be <= 100`, 400);
    return {
      sku: String(l.sku),
      qty: round2(l.qty),
      hargaJual: null,       // diisi applyPrices
      diskonPersen,
      unitCost: null,
      note: trimText(l.note, 200) || undefined,
    };
  });

  let dueDate;
  if (body.dueDate) {
    dueDate = new Date(body.dueDate);
    if (Number.isNaN(dueDate.getTime())) throw new HttpError('Invalid due date', 400);
    const day = new Date(date);
    day.setHours(0, 0, 0, 0);
    if (dueDate < day) throw new HttpError('Due date cannot be before the invoice date', 400);
  }

  return {
    customer: String(body.customer),
    gudang: String(body.gudang),
    date,
    dueDate,
    taxRate,
    priceIncludesTax,
    discountAmount: round2(discountAmount),
    note: trimText(body.note),
    lines,
  };
};

/**
 * Referensi di dalam transaksi + kunci (bentrok dengan hapus customer/gudang/produk).
 * Customer, gudang & SKU harus ada dan aktif. Mengisi line.produk.
 */
const resolveRefs = async (parsed) => {
  const skuIds = parsed.lines.map((l) => l.sku);
  const owners = await ProdukSku.find({ _id: { $in: skuIds } }).select('produk').lean();
  await lock(
    ref('customer', parsed.customer), ref('gudang', parsed.gudang),
    [...new Set(owners.map((s) => String(s.produk)))].map((id) => ref('produk', id))
  );
  const customer = await Customer.findById(parsed.customer).select('name isActive termDays').lean();
  if (!customer) throw new HttpError('Please select a valid customer', 400);
  if (customer.isActive === false) throw new HttpError(`Customer ${customer.name} is inactive`, 400);
  const gudang = await Gudang.findById(parsed.gudang).select('code isActive').lean();
  if (!gudang) throw new HttpError('Please select a valid warehouse', 400);
  if (gudang.isActive === false) throw new HttpError(`Warehouse ${gudang.code} is inactive`, 400);

  const skus = await ProdukSku.find({ _id: { $in: skuIds } }).select('sku produk isActive').lean();
  if (skus.length !== new Set(skuIds).size) throw new HttpError('One or more SKUs no longer exist', 400);
  const inactive = skus.find((s) => s.isActive === false);
  if (inactive) throw new HttpError(`${inactive.sku} is inactive and cannot be sold`, 400);
  const produkOf = new Map(skus.map((s) => [String(s._id), s.produk]));
  parsed.lines.forEach((l) => { l.produk = produkOf.get(l.sku); });
  return { customer };
};

/**
 * Harga jual baris = price list customer (aktif & SKU ada) atau harga jual SKU. Harga dibekukan:
 * user tidak bisa mengubahnya, pengurangan hanya lewat diskon baris / dokumen. Dihitung ulang setiap
 * draft disimpan (di dalam transaksi); dokumen POSTED menyimpan harga saat itu.
 */
const applyPrices = async (parsed) => {
  const prices = await resolvePrices(parsed.customer, parsed.lines.map((l) => l.sku));
  parsed.lines.forEach((l) => {
    l.hargaJual = round2(prices.get(l.sku)?.price ?? 0);
    l.subtotal = salesLineSubtotal(l);
  });
  const subtotal = round2(parsed.lines.reduce((s, l) => s + l.subtotal, 0));
  if (parsed.discountAmount > subtotal) throw new HttpError('Document discount cannot exceed the subtotal', 400);
};

/** Isi dokumen + pajak (salinan setting bila tidak dikirim) + total */
const fillInvoice = (doc, parsed, settings, customer) => {
  doc.customer = parsed.customer;
  doc.gudang = parsed.gudang;
  doc.date = parsed.date;
  // jatuh tempo: isian user, atau tanggal invoice + termin customer
  doc.dueDate = parsed.dueDate || new Date(new Date(parsed.date).setHours(0, 0, 0, 0) + (customer?.termDays || 0) * DAY);
  doc.note = parsed.note;
  doc.lines = parsed.lines;
  doc.discountAmount = parsed.discountAmount;
  if (parsed.taxRate !== undefined) doc.taxRate = parsed.taxRate;
  else if (doc.isNew) doc.taxRate = settings['tax.isPKP'] !== false ? (settings['tax.ppnRate'] ?? 0) : 0;
  if (parsed.priceIncludesTax !== undefined) doc.priceIncludesTax = parsed.priceIncludesTax;
  else if (doc.isNew) doc.priceIncludesTax = settings['sales.priceIncludesTax'] === true;
  Object.assign(doc, salesTotals(parsed.lines, doc));
};

const populateDoc = (query) => query
  .populate('customer', 'code name phone address provinsi kota kecamatan kodePos npwp isWalkIn isActive')
  .populate('gudang', 'code name isActive')
  .populate('salesOrders', 'no customerPoNo deliveryMethod')
  .populate('deliveryOrders', 'no date')
  .populate('lines.sku', 'sku variantValues isActive hargaJual')
  .populate({ path: 'lines.produk', select: 'name uom', populate: { path: 'uom', select: 'code' } })
  .populate('createdBy', 'name')
  .populate('updatedBy', 'name')
  .populate('postedBy', 'name')
  .populate('cancelledBy', 'name');

const loadDoc = async (id) => {
  if (!mongoose.isValidObjectId(id)) throw new HttpError('Sales invoice not found', 404);
  const doc = await SalesInvoice.findById(id);
  if (!doc) throw new HttpError('Sales invoice not found', 404);
  return doc;
};

const loadDraft = async (req, id) => {
  const doc = await loadDoc(id);
  assertGudang(req, doc.gudang);
  if (doc.status !== 'DRAFT') throw new HttpError(`Invoice is already ${doc.status.toLowerCase()} and can no longer be changed`, 400);
  return doc;
};

// ---------------------------------------------------------------- baca

/**
 * GET /api/sales-invoice — daftar (tanpa baris)
 * Query: search (no / catatan / nama customer), status, customer, gudang, from, to, page, pageSize, sort*
 * + lineCount. cogs & grossProfit hanya untuk vendorPrice:view.
 */
exports.getInvoices = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || 1) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || 10) || 10, 1), 100);
    const sortField = SORTABLE_FIELDS.includes(req.query.sortField) ? req.query.sortField : 'createdDate';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const filter = {};

    if (req.query.search) {
      const rx = { $regex: escapeRegex(req.query.search), $options: 'i' };
      const customers = await Customer.find({ $or: [{ name: rx }, { code: rx }] }).distinct('_id');
      filter.$or = [{ no: rx }, { note: rx }, { customer: { $in: customers } }];
    }
    if (STATUSES.includes(req.query.status)) filter.status = req.query.status;
    // status bayar (hanya invoice POSTED): OPEN = belum lunas, OVERDUE = belum lunas & lewat jatuh tempo
    const pay = req.query.paymentStatus;
    if (PAYMENT_FILTERS.includes(pay)) {
      filter.status = 'POSTED';
      if (pay === 'OPEN' || pay === 'OVERDUE') filter.paymentStatus = { $in: ['UNPAID', 'PARTIAL'] };
      else filter.paymentStatus = pay;
      if (pay === 'OVERDUE') filter.dueDate = { $lt: startOfToday() };
    }
    if (req.query.customer) {
      if (!mongoose.isValidObjectId(req.query.customer)) return errorResponse(res, 'Invalid customer', 400);
      filter.customer = req.query.customer;
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

    const [totalData, docs] = await Promise.all([
      SalesInvoice.countDocuments(filter),
      SalesInvoice.find(filter)
        .select('-lines')
        .populate('customer', 'code name isWalkIn')
        .populate('salesOrders', 'no')
        .populate('gudang', 'code name')
        .populate('createdBy', 'name')
        .populate('updatedBy', 'name')
        .sort({ [sortField]: sortOrder, _id: sortOrder })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);
    const counts = await SalesInvoice.aggregate([
      { $match: { _id: { $in: docs.map((d) => d._id) } } },
      { $project: { lineCount: { $size: '$lines' } } },
    ]);
    const countMap = new Map(counts.map((c) => [String(c._id), c.lineCount]));
    const canSeeCost = canSeeCostOf(req);
    docs.forEach((d) => {
      d.lineCount = countMap.get(String(d._id)) || 0;
      if (d.status === 'POSTED') {
        d.balance = invoiceBalance(d).balance;
        d.overdue = d.balance > 0 && d.dueDate && new Date(d.dueDate) < startOfToday();
      }
      if (canSeeCost && d.cogs !== null && d.cogs !== undefined) d.grossProfit = round2(d.dpp - d.cogs);
      else delete d.cogs;
    });

    return successResponse(res, { dataSalesInvoice: docs, canSeeCost, totalData, currentPage: page, totalPages: Math.ceil(totalData / pageSize) });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * GET /api/sales-invoice/:id — dokumen lengkap.
 * Draft: + currentQty (saldo gudang). vendorPrice:view: unitCost (draft = HPP saat ini, perkiraan),
 * cost, netRevenue & margin per baris, cogs & grossProfit dokumen.
 */
exports.getInvoice = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 'Sales invoice not found', 404);
    const doc = await populateDoc(SalesInvoice.findById(req.params.id)).lean();
    if (!doc) return errorResponse(res, 'Sales invoice not found', 404);
    assertGudang(req, doc.gudang?._id ?? doc.gudang);

    const skuIds = doc.lines.map((l) => l.sku?._id).filter(Boolean);
    if (doc.status === 'DRAFT' && doc.gudang) {
      const balances = await getBalances(doc.gudang._id, skuIds);
      doc.lines.forEach((l) => { l.currentQty = l.sku ? (balances.get(String(l.sku._id)) || 0) : null; });
    }

    if (doc.status !== 'DRAFT') {
      doc.returns = await SalesReturn.find({ salesInvoice: doc._id })
        .select('no date status total').sort({ date: 1, _id: 1 }).lean();
      doc.payments = await SalesPayment.find({ salesInvoice: doc._id })
        .select('no type date method amount reference note status cancelReason createdBy')
        .populate('createdBy', 'name')
        .sort({ date: 1, _id: 1 }).lean();
      if (doc.status === 'POSTED') {
        doc.balance = invoiceBalance(doc).balance;
        doc.overdue = doc.balance > 0 && doc.dueDate && new Date(doc.dueDate) < startOfToday();
      }
    }

    doc.canSeeCost = canSeeCostOf(req);
    if (doc.canSeeCost) {
      if (doc.status === 'DRAFT') {
        const skus = await ProdukSku.find({ _id: { $in: skuIds } }).select('avgCost').lean();
        const avg = new Map(skus.map((s) => [String(s._id), s.avgCost ?? null]));
        doc.lines.forEach((l) => { l.unitCost = l.sku ? avg.get(String(l.sku._id)) ?? null : null; });
      }
      let cogs = 0;
      let missing = false;
      doc.lines.forEach((l) => {
        l.netRevenue = netLineRevenue(l, doc);
        if (l.unitCost === null || l.unitCost === undefined) {
          l.cost = null;
          l.margin = null;
          missing = true;
        } else {
          l.cost = round2(l.qty * l.unitCost);
          l.margin = round2(l.netRevenue - l.cost);
          cogs += l.cost;
        }
      });
      if (doc.status === 'DRAFT') doc.cogs = missing && !cogs ? null : round2(cogs);
      doc.grossProfit = doc.cogs === null || doc.cogs === undefined ? null : round2(doc.dpp - doc.cogs);
      doc.costMissing = missing;
    } else {
      doc.lines.forEach((l) => { delete l.unitCost; });
      delete doc.cogs;
    }
    return successResponse(res, doc);
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * GET /api/sales-invoice/skus?gudang=&search=&customer= — cari SKU aktif untuk baris penjualan:
 * + qty (saldo gudang), uom, hargaJual (price list customer atau harga default) & priceSource;
 * + avgCost untuk vendorPrice:view. Maks. 20 hasil.
 */
exports.searchSkus = async (req, res) => {
  try {
    const { gudang } = req.query;
    if (gudang && mongoose.isValidObjectId(gudang)) assertGudang(req, gudang);
    const q = String(req.query.search || '').trim();
    if (!q) return successResponse(res, []);
    const rx = { $regex: escapeRegex(q), $options: 'i' };
    const produkIds = await Produk.find({ name: rx }).distinct('_id');
    const skus = await ProdukSku.find({ isActive: true, $or: [{ sku: rx }, { produk: { $in: produkIds } }] })
      .select('sku produk variantValues isActive hargaJual avgCost')
      .populate({ path: 'produk', select: 'name uom', populate: { path: 'uom', select: 'code' } })
      .sort({ sku: 1 })
      .limit(20)
      .lean();
    const balances = gudang && mongoose.isValidObjectId(gudang) ? await getBalances(gudang, skus.map((s) => s._id)) : new Map();
    const prices = await resolvePrices(req.query.customer, skus.map((s) => s._id));
    const canSeeCost = canSeeCostOf(req);
    return successResponse(res, skus.map((s) => ({
      _id: s._id,
      sku: s.sku,
      isActive: s.isActive !== false,
      variant: (s.variantValues || []).map((v) => v.value).join(' / ') || 'Default',
      produk: s.produk ? { _id: s.produk._id, name: s.produk.name } : null,
      uom: s.produk?.uom?.code || '',
      qty: balances.get(String(s._id)) || 0,
      hargaJual: prices.get(String(s._id))?.price ?? s.hargaJual ?? 0,
      priceSource: prices.get(String(s._id))?.source || 'default',
      ...(canSeeCost ? { avgCost: s.avgCost ?? null } : {}),
    })));
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * POST /api/sales-invoice/skus/prices  body: { customer, skus: [id] } -> { skuId: { price, source } }
 * Harga jual untuk customer (dipakai saat customer draft diganti).
 */
exports.skuPrices = async (req, res) => {
  try {
    const ids = (Array.isArray(req.body.skus) ? req.body.skus : []).filter((id) => mongoose.isValidObjectId(id));
    if (ids.length > MAX_LINES) return errorResponse(res, `At most ${MAX_LINES} SKUs`, 400);
    const prices = await resolvePrices(req.body.customer, ids);
    return successResponse(res, Object.fromEntries([...prices.entries()].map(([id, p]) => [id, { price: p.price, source: p.source }])));
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- draft

// POST /api/sales-invoice — buat draft
exports.createInvoice = async (req, res) => {
  try {
    const parsed = parseInvoice(req.body);
    assertGudang(req, parsed.gudang);
    const doc = await runInTransaction(async () => {
      const { customer } = await resolveRefs(parsed);
      await applyPrices(parsed);
      const settings = await getSettings();
      const doc = new SalesInvoice({ no: await nextDocNo('INV'), status: 'DRAFT', createdBy: req.user._id });
      fillInvoice(doc, parsed, settings, customer);
      await doc.save();
      await audit.logCreate(req, 'salesInvoice', [doc]);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} saved as draft`, 201);
  } catch (error) {
    return handleError(res, error);
  }
};

// PUT /api/sales-invoice/:id — ubah draft
exports.updateInvoice = async (req, res) => {
  try {
    const doc = await runInTransaction(async () => {
      const doc = await loadDraft(req, req.params.id);
      const parsed = parseInvoice(req.body);
      assertGudang(req, parsed.gudang);
      const { customer } = await resolveRefs(parsed);
      await applyPrices(parsed);
      const before = await audit.snap('salesInvoice', [doc]);
      fillInvoice(doc, parsed, await getSettings(), customer);
      doc.updatedDate = new Date();
      doc.updatedBy = req.user._id;
      await doc.save();
      await audit.logUpdate(req, 'salesInvoice', before, [doc]);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} successfully updated`);
  } catch (error) {
    return handleError(res, error);
  }
};

// DELETE /api/sales-invoice/:id — hanya draft
exports.deleteInvoice = async (req, res) => {
  try {
    const doc = await runInTransaction(async () => {
      const doc = await loadDoc(req.params.id);
      assertGudang(req, doc.gudang);
      if (doc.status !== 'DRAFT') throw new HttpError('Only draft invoices can be deleted. Cancel a posted invoice instead.', 400);
      const before = await audit.snap('salesInvoice', [doc]);
      await doc.deleteOne();
      await audit.logDelete(req, 'salesInvoice', before);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} successfully deleted`);
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- post / batal (izin 'post')

/**
 * POST /api/sales-invoice/:id/post — stok keluar (SALE) di gudang dokumen. Stok tidak cukup -> 400,
 * seluruh dokumen batal. HPP saat itu disimpan per baris; cogs = jumlah qty x HPP.
 */
exports.postInvoice = async (req, res) => {
  try {
    const doc = await runInTransaction(async () => {
      const doc = await loadDraft(req, req.params.id);
      if (!doc.lines.length) throw new HttpError('Invoice has no lines', 400);
      // validasi ulang referensi (customer / gudang / SKU bisa dinonaktifkan sejak draft disimpan)
      await resolveRefs({
        customer: String(doc.customer),
        gudang: String(doc.gudang),
        lines: doc.lines.map((l) => ({ sku: String(l.sku) })),
      });

      const before = await audit.snap('salesInvoice', [doc]);
      const movements = await applyMovements(req, doc.lines.map((l) => ({
        sku: l.sku,
        gudang: doc.gudang,
        qty: -l.qty,
        type: 'SALE',
        note: l.note || doc.note,
      })), { refType: 'SalesInvoice', refId: doc._id, refNo: doc.no });

      const costOf = new Map(movements.map((m) => [String(m.sku), m.unitCost ?? null]));
      let cogs = 0;
      doc.lines.forEach((l) => {
        l.unitCost = costOf.get(String(l.sku)) ?? null;
        cogs += l.qty * (l.unitCost || 0);
      });
      doc.cogs = round2(cogs);
      if (!doc.dueDate) doc.dueDate = new Date(new Date(doc.date).setHours(0, 0, 0, 0));
      doc.returnedAmount = 0;
      doc.paidAmount = 0;
      doc.paymentStatus = invoiceBalance(doc).paymentStatus;
      doc.status = 'POSTED';
      doc.postedBy = req.user._id;
      doc.postedDate = new Date();
      await doc.save();
      await audit.logUpdate(req, 'salesInvoice', before, [doc]);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} posted`);
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * POST /api/sales-invoice/:id/cancel  body: { reason } — hanya POSTED: movement pembalik,
 * barang kembali ke gudang dengan HPP saat dijual. Invoice atas Delivery Order (source SALES_ORDER):
 * stok tidak berubah, DO kembali "belum ditagih".
 */
exports.cancelInvoice = async (req, res) => {
  try {
    const cancelReason = trimText(req.body.reason);
    if (!cancelReason) return errorResponse(res, 'Cancellation reason is required', 400);

    const doc = await runInTransaction(async () => {
      const doc = await loadDoc(req.params.id);
      assertGudang(req, doc.gudang);
      if (doc.status !== 'POSTED') {
        throw new HttpError(doc.status === 'DRAFT' ? 'Draft invoices are deleted, not cancelled' : 'Invoice is already cancelled', 400);
      }
      await lock(ref('salesInvoice', doc._id), ref('gudang', doc.gudang));
      const returns = await SalesReturn.countDocuments({ salesInvoice: doc._id, status: { $in: ['DRAFT', 'POSTED'] } });
      if (returns) throw new HttpError(`Invoice has ${returns} sales return(s). Cancel or delete them first.`, 400);
      const payments = await SalesPayment.countDocuments({ salesInvoice: doc._id, status: 'POSTED' });
      if (payments) throw new HttpError(`Invoice has ${payments} payment(s). Cancel them first.`, 400);

      const before = await audit.snap('salesInvoice', [doc]);
      const batchId = audit.newBatchId();
      if (doc.source === 'SALES_ORDER') {
        // tagihan atas Delivery Order: stok tidak berubah (barang tetap terkirim), DO bisa ditagih ulang
        await lock((doc.deliveryOrders || []).map((id) => ref('deliveryOrder', id)));
        const dlvs = await DeliveryOrder.find({ _id: { $in: doc.deliveryOrders || [] } });
        for (const dlv of dlvs) {
          if (String(dlv.invoice) !== String(doc._id)) continue;
          const dlvBefore = await audit.snap('deliveryOrder', [dlv]);
          dlv.invoice = null;
          await dlv.save();
          await audit.logUpdate(req, 'deliveryOrder', dlvBefore, [dlv], { batchId });
        }
      } else {
        await applyMovements(req, doc.lines.map((l) => ({
          sku: l.sku,
          gudang: doc.gudang,
          qty: l.qty,
          unitCost: l.unitCost,
          type: 'SALE',
          note: `Cancelled: ${cancelReason}`,
        })), { refType: 'SalesInvoice', refId: doc._id, refNo: doc.no, isReversal: true });
      }

      doc.status = 'CANCELLED';
      doc.paymentStatus = null;
      doc.cancelledBy = req.user._id;
      doc.cancelledDate = new Date();
      doc.cancelReason = cancelReason;
      await doc.save();
      await audit.logUpdate(req, 'salesInvoice', before, [doc], { batchId });
      return doc;
    });
    return successResponse(res, doc, `${doc.no} cancelled`);
  } catch (error) {
    return handleError(res, error);
  }
};
