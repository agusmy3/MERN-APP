const mongoose = require('mongoose');
const SalesOrder = require('../models/SalesOrder');
const DeliveryOrder = require('../models/DeliveryOrder');
const SalesInvoice = require('../models/SalesInvoice');
const Customer = require('../models/Customer');
const ProdukSku = require('../models/ProdukSku');
const Produk = require('../models/Produk');
const Gudang = require('../models/Gudang');
const { hasPermission } = require('../config/permissions');
const { successResponse, errorResponse } = require('../helpers/responseHelper');
const audit = require('../helpers/auditLogger');
const { runInTransaction, HttpError, lock, ref } = require('../helpers/transaction');
const { getBalances, nextDocNo } = require('../helpers/stockHelper');
const { getSettings } = require('../helpers/settings');
const { checkAmount, round2 } = require('../helpers/number');
const { salesLineSubtotal, salesTotals, netLineRevenue, soOutstanding } = require('../helpers/salesHelper');
const { committedQty, customerCredit } = require('../helpers/salesOrderHelper');
const { resolvePrices } = require('../helpers/priceHelper');
const { parseLocation } = require('../helpers/locationHelper');
const { assertGudang, applyGudangFilter } = require('../helpers/gudangAccess');
const { MAX_LINES } = require('../config/stock');

const STATUSES = ['DRAFT', 'OPEN', 'PARTIAL', 'DELIVERED', 'CLOSED', 'CANCELLED'];
const SORTABLE_FIELDS = ['no', 'date', 'requestedDate', 'total', 'createdDate', 'updatedDate'];
const METHODS = ['DELIVERY', 'PICKUP'];

const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status, error.details);
  if (error.name === 'ValidationError' || error.name === 'CastError') return errorResponse(res, error.message, 400);
  return errorResponse(res, error.message, 500);
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const trimText = (v, max = 500) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));
const canSeeCostOf = (req) => hasPermission(req.user, 'vendorPrice', 'view');
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

/** Alamat kirim dari body (undefined = ambil dari customer nanti). Wilayah divalidasi seperti Gudang. */
const parseShipTo = (input) => {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== 'object') throw new HttpError('Invalid shipping address', 400);
  const loc = parseLocation({
    alamat: input.alamat ?? '', provinsi: input.provinsi ?? '', kota: input.kota ?? '', kecamatan: input.kecamatan ?? '',
    kodePos: input.kodePos ?? '', latitude: input.latitude ?? null, longitude: input.longitude ?? null,
  });
  return { name: trimText(input.name, 120), phone: trimText(input.phone, 40), ...loc, alamat: trimText(loc.alamat, 500) };
};

/** Validasi isi SO dari body (murni). Pajak undefined = System Settings. Harga diisi applyPrices. */
const parseSo = (body) => {
  if (!mongoose.isValidObjectId(body.customer)) throw new HttpError('Please select a customer', 400);
  if (!mongoose.isValidObjectId(body.gudang)) throw new HttpError('Please select a warehouse', 400);

  const date = body.date ? new Date(body.date) : new Date();
  if (Number.isNaN(date.getTime())) throw new HttpError('Invalid order date', 400);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  if (date > endOfToday) throw new HttpError('Order date cannot be in the future', 400);
  let requestedDate = null;
  if (body.requestedDate) {
    requestedDate = new Date(body.requestedDate);
    if (Number.isNaN(requestedDate.getTime())) throw new HttpError('Invalid requested delivery date', 400);
    if (requestedDate < startOfDay(date)) throw new HttpError('Requested delivery date cannot be before the order date', 400);
  }

  const deliveryMethod = body.deliveryMethod === undefined || body.deliveryMethod === null ? 'DELIVERY' : body.deliveryMethod;
  if (!METHODS.includes(deliveryMethod)) throw new HttpError('Invalid delivery method', 400);

  let taxRate;
  if (body.taxRate !== undefined && body.taxRate !== null && body.taxRate !== '') {
    const err = checkAmount(body.taxRate, 'Tax rate');
    if (err) throw new HttpError(err, 400);
    taxRate = round2(body.taxRate);
    if (taxRate > 100) throw new HttpError('Tax rate must be <= 100', 400);
  }
  const priceIncludesTax = body.priceIncludesTax === undefined || body.priceIncludesTax === null
    ? undefined : body.priceIncludesTax === true;

  const amount = (v, label) => {
    const value = v === undefined || v === null || v === '' ? 0 : v;
    const err = checkAmount(value, label);
    if (err) throw new HttpError(err, 400);
    return round2(value);
  };
  const discountAmount = amount(body.discountAmount, 'Document discount');
  const shippingCharge = deliveryMethod === 'PICKUP' ? 0 : amount(body.shippingCharge, 'Shipping charge');

  const input = Array.isArray(body.lines) ? body.lines : [];
  if (!input.length) throw new HttpError('Add at least one item', 400);
  if (input.length > MAX_LINES) throw new HttpError(`A sales order can have at most ${MAX_LINES} lines`, 400);
  const seen = new Set();
  const lines = input.map((l, i) => {
    const n = `Line ${i + 1}`;
    if (!mongoose.isValidObjectId(l?.sku)) throw new HttpError(`${n}: invalid SKU`, 400);
    if (seen.has(String(l.sku))) throw new HttpError(`${n}: the same SKU appears more than once`, 400);
    seen.add(String(l.sku));
    const err = checkAmount(l.qty, 'Quantity', { min: 0, exclusive: true })
      || checkAmount(l.diskonPersen ?? 0, 'Discount');
    if (err) throw new HttpError(`${n}: ${err}`, 400);
    const diskonPersen = round2(l.diskonPersen ?? 0);
    if (diskonPersen > 100) throw new HttpError(`${n}: Discount must be <= 100`, 400);
    return { sku: String(l.sku), qty: round2(l.qty), hargaJual: null, diskonPersen, qtyDelivered: 0, note: trimText(l.note, 200) || undefined };
  });

  return {
    customer: String(body.customer),
    gudang: String(body.gudang),
    date,
    requestedDate,
    customerPoNo: trimText(body.customerPoNo, 100),
    deliveryMethod,
    shipTo: deliveryMethod === 'PICKUP' ? {} : parseShipTo(body.shipTo),
    taxRate,
    priceIncludesTax,
    discountAmount,
    shippingCharge,
    note: trimText(body.note),
    lines,
  };
};

/**
 * Referensi di dalam transaksi + kunci (bentrok dengan hapus customer / gudang / produk).
 * Customer aktif & bukan walk-in, gudang & SKU aktif. Mengisi line.produk.
 */
const resolveRefs = async (parsed) => {
  const skuIds = parsed.lines.map((l) => l.sku);
  const owners = await ProdukSku.find({ _id: { $in: skuIds } }).select('produk').lean();
  await lock(
    ref('customer', parsed.customer), ref('gudang', parsed.gudang),
    [...new Set(owners.map((s) => String(s.produk)))].map((id) => ref('produk', id))
  );
  const customer = await Customer.findById(parsed.customer)
    .select('name phone address provinsi kota kecamatan kodePos latitude longitude isActive isWalkIn').lean();
  if (!customer) throw new HttpError('Please select a valid customer', 400);
  if (customer.isWalkIn) throw new HttpError('Sales orders need a named customer, not the walk-in customer', 400);
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
 * Harga dibekukan: price list customer / harga jual SKU (lihat Sales Invoice applyPrices).
 * quotePrices (Map skuId -> harga): SO dari quotation memakai harga penawaran untuk SKU-nya.
 */
const applyPrices = async (parsed, quotePrices = null) => {
  const prices = await resolvePrices(parsed.customer, parsed.lines.map((l) => l.sku));
  parsed.lines.forEach((l) => {
    l.hargaJual = round2(quotePrices?.has(l.sku) ? quotePrices.get(l.sku) : (prices.get(l.sku)?.price ?? 0));
    l.subtotal = salesLineSubtotal(l);
  });
  const subtotal = round2(parsed.lines.reduce((s, l) => s + l.subtotal, 0));
  if (parsed.discountAmount > subtotal) throw new HttpError('Document discount cannot exceed the subtotal', 400);
};

/** Alamat kirim default = alamat customer */
const customerShipTo = (c) => ({
  name: c.name || '', phone: c.phone || '', alamat: c.address || '', provinsi: c.provinsi || '', kota: c.kota || '',
  kecamatan: c.kecamatan || '', kodePos: c.kodePos || '', latitude: c.latitude ?? null, longitude: c.longitude ?? null,
});

const fillSo = (doc, parsed, settings, customer) => {
  doc.customer = parsed.customer;
  doc.gudang = parsed.gudang;
  doc.date = parsed.date;
  doc.requestedDate = parsed.requestedDate;
  doc.customerPoNo = parsed.customerPoNo;
  doc.deliveryMethod = parsed.deliveryMethod;
  doc.shipTo = parsed.deliveryMethod === 'PICKUP' ? {} : (parsed.shipTo ?? customerShipTo(customer));
  if (parsed.deliveryMethod === 'DELIVERY' && !doc.shipTo?.alamat) {
    throw new HttpError('Shipping address is required for delivery (fill it in, or set the customer address)', 400);
  }
  doc.note = parsed.note;
  doc.lines = parsed.lines;
  doc.discountAmount = parsed.discountAmount;
  doc.shippingCharge = parsed.shippingCharge;
  if (parsed.taxRate !== undefined) doc.taxRate = parsed.taxRate;
  else if (doc.isNew) doc.taxRate = settings['tax.isPKP'] !== false ? (settings['tax.ppnRate'] ?? 0) : 0;
  if (parsed.priceIncludesTax !== undefined) doc.priceIncludesTax = parsed.priceIncludesTax;
  else if (doc.isNew) doc.priceIncludesTax = settings['sales.priceIncludesTax'] === true;
  Object.assign(doc, salesTotals(parsed.lines, doc));
};

const fmt = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

/**
 * Cek kredit saat konfirmasi (di dalam transaksi; customer sudah dikunci resolveRefs -> konfirmasi SO
 * bersamaan untuk customer yang sama bentrok & diulang dengan posisi terbaru):
 * - batas kredit (> 0): piutang + SO lain belum ditagih + total SO ini <= limit
 * - setting sales.blockOverdue: tidak ada invoice belum lunas yang lewat jatuh tempo
 * Melanggar -> 409 + details (posisi kredit), kecuali body.creditOverride.reason & izin salesOrder:approve.
 */
const checkCredit = async (doc, req, settings) => {
  const credit = await customerCredit(doc.customer, { excludeSo: doc._id });
  const after = round2(credit.exposure + (doc.total || 0));
  const issues = [];
  if (credit.limit > 0 && after > credit.limit) {
    issues.push(`credit limit exceeded (outstanding ${fmt(credit.exposure)} + this order ${fmt(doc.total)} = ${fmt(after)} > limit ${fmt(credit.limit)})`);
  }
  if (settings['sales.blockOverdue'] !== false && credit.overdue.count) {
    issues.push(`${credit.overdue.count} overdue invoice(s) totalling ${fmt(credit.overdue.amount)}`);
  }
  if (!issues.length) return;

  const override = req.body?.creditOverride;
  const canApprove = hasPermission(req.user, 'salesOrder', 'approve');
  if (!override) {
    throw new HttpError(`Customer credit check failed: ${issues.join('; ')}.${canApprove ? ' Approve with a reason to confirm anyway.' : ' Ask a user with approval rights to confirm it.'}`,
      409, { code: 'CREDIT_BLOCK', credit, orderTotal: doc.total, exposureAfter: after, issues, canApprove });
  }
  if (!canApprove) throw new HttpError('You are not allowed to approve sales orders over the credit check', 403);
  const reason = trimText(override.reason);
  if (!reason) throw new HttpError('Approval reason is required', 400);
  doc.creditOverrideReason = reason;
  doc.creditOverrideNote = issues.join('; ');
  doc.creditOverrideBy = req.user._id;
  doc.creditOverrideDate = new Date();
};

/** Harga penawaran untuk SO hasil konversi quotation: Map skuId -> harga (null = tanpa quotation) */
const quotationPrices = async (quotationId) => {
  if (!quotationId) return null;
  const q = await require('../models/Quotation').findById(quotationId).select('lines.sku lines.hargaJual').lean();
  return q ? new Map(q.lines.map((l) => [String(l.sku), l.hargaJual])) : null;
};

/**
 * SO DRAFT dari quotation (di dalam transaksi pemanggil): customer bernama, gudang, metode, baris, diskon,
 * ongkir & pajak disalin; harga = harga penawaran; alamat kirim = alamat customer. -> dokumen SO
 */
exports.createDraftFromQuotation = async (req, q, customerId) => {
  const parsed = {
    customer: String(customerId),
    gudang: String(q.gudang),
    date: new Date(),
    requestedDate: null,
    customerPoNo: '',
    deliveryMethod: q.deliveryMethod,
    shipTo: undefined,
    taxRate: q.taxRate,
    priceIncludesTax: q.priceIncludesTax,
    discountAmount: q.discountAmount || 0,
    shippingCharge: q.deliveryMethod === 'PICKUP' ? 0 : (q.shippingCharge || 0),
    note: q.note || '',
    lines: q.lines.map((l) => ({ sku: String(l.sku), qty: l.qty, hargaJual: null, diskonPersen: l.diskonPersen || 0, qtyDelivered: 0, note: l.note })),
  };
  assertGudang(req, parsed.gudang);
  const { customer } = await resolveRefs(parsed);
  await applyPrices(parsed, new Map(q.lines.map((l) => [String(l.sku), l.hargaJual])));
  const doc = new SalesOrder({ no: await nextDocNo('SO'), createdBy: req.user._id, quotation: q._id });
  fillSo(doc, parsed, await getSettings(), customer);
  await doc.save();
  await audit.logCreate(req, 'salesOrder', [doc]);
  return doc;
};

const confirm = async (doc, req, settings) => {
  await checkCredit(doc, req, settings || await getSettings());
  doc.status = 'OPEN';
  doc.confirmedBy = req.user._id;
  doc.confirmedDate = new Date();
};

const populateSo = (query) => query
  .populate('customer', 'code name phone address provinsi kota kecamatan kodePos npwp termDays creditLimit isActive')
  .populate('gudang', 'code name isActive')
  .populate('lines.sku', 'sku variantValues isActive hargaJual')
  .populate({ path: 'lines.produk', select: 'name uom', populate: { path: 'uom', select: 'code' } })
  .populate('createdBy', 'name')
  .populate('updatedBy', 'name')
  .populate('confirmedBy', 'name')
  .populate('creditOverrideBy', 'name')
  .populate('quotation', 'no validUntil')
  .populate('closedBy', 'name')
  .populate('cancelledBy', 'name');

const loadDraft = async (req, id) => {
  if (!mongoose.isValidObjectId(id)) throw new HttpError('Sales order not found', 404);
  const doc = await SalesOrder.findById(id);
  if (!doc) throw new HttpError('Sales order not found', 404);
  assertGudang(req, doc.gudang);
  if (doc.status !== 'DRAFT') throw new HttpError('Only draft sales orders can be changed. Cancel or close it instead.', 400);
  return doc;
};

// ---------------------------------------------------------------- baca

/**
 * GET /api/sales-order — daftar (tanpa baris). status=ACTIVE -> OPEN + PARTIAL.
 * Query: search (no / no. PO customer / catatan / customer), status, customer, gudang, from, to, paginasi
 * + lineCount, deliveredPercent (qty satuan dasar).
 */
exports.getSalesOrders = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || 1) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || 10) || 10, 1), 100);
    const sortField = SORTABLE_FIELDS.includes(req.query.sortField) ? req.query.sortField : 'createdDate';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const filter = {};
    if (req.query.search) {
      const rx = { $regex: escapeRegex(req.query.search), $options: 'i' };
      const customers = await Customer.find({ $or: [{ name: rx }, { code: rx }] }).distinct('_id');
      filter.$or = [{ no: rx }, { customerPoNo: rx }, { note: rx }, { customer: { $in: customers } }];
    }
    if (req.query.status === 'ACTIVE') filter.status = { $in: ['OPEN', 'PARTIAL'] };
    else if (STATUSES.includes(req.query.status)) filter.status = req.query.status;
    if (req.query.customer) {
      if (!mongoose.isValidObjectId(req.query.customer)) return errorResponse(res, 'Invalid customer', 400);
      filter.customer = req.query.customer;
    }
    if (req.query.gudang && !mongoose.isValidObjectId(req.query.gudang)) return errorResponse(res, 'Invalid warehouse', 400);
    applyGudangFilter(req, filter, req.query.gudang);
    if (req.query.from || req.query.to) {
      filter.date = {};
      if (req.query.from) filter.date.$gte = new Date(`${req.query.from}T00:00:00`);
      if (req.query.to) filter.date.$lte = new Date(`${req.query.to}T23:59:59.999`);
      if (Object.values(filter.date).some((d) => Number.isNaN(d.getTime()))) return errorResponse(res, 'Invalid date', 400);
    }

    const [totalData, docs] = await Promise.all([
      SalesOrder.countDocuments(filter),
      SalesOrder.find(filter)
        .select('-lines')
        .populate('customer', 'code name')
        .populate('gudang', 'code name')
        .populate('createdBy', 'name')
        .populate('updatedBy', 'name')
        .sort({ [sortField]: sortOrder, _id: sortOrder })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);
    const stats = await SalesOrder.aggregate([
      { $match: { _id: { $in: docs.map((d) => d._id) } } },
      { $project: { lineCount: { $size: '$lines' }, qty: { $sum: '$lines.qty' }, delivered: { $sum: '$lines.qtyDelivered' } } },
    ]);
    const statMap = new Map(stats.map((s) => [String(s._id), s]));
    docs.forEach((d) => {
      const s = statMap.get(String(d._id));
      d.lineCount = s?.lineCount || 0;
      d.deliveredPercent = s?.qty ? Math.min(Math.round((s.delivered / s.qty) * 100), 100) : 0;
    });
    return successResponse(res, { dataSalesOrder: docs, totalData, currentPage: page, totalPages: Math.ceil(totalData / pageSize) });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * GET /api/sales-order/:id — SO lengkap: + outstanding per baris, pengiriman (DO) & invoice-nya.
 * DRAFT / OPEN / PARTIAL: + currentQty (stok gudang), committed (dipesan SO lain), available.
 * vendorPrice:view: unitCost (HPP saat ini), perkiraan margin per baris & laba kotor.
 */
exports.getSalesOrder = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 'Sales order not found', 404);
    const doc = await populateSo(SalesOrder.findById(req.params.id)).lean();
    if (!doc) return errorResponse(res, 'Sales order not found', 404);
    assertGudang(req, doc.gudang?._id ?? doc.gudang);

    const skuIds = doc.lines.map((l) => l.sku?._id).filter(Boolean);
    doc.lines.forEach((l) => { l.outstanding = soOutstanding(l); });
    if (['DRAFT', 'OPEN', 'PARTIAL'].includes(doc.status) && doc.gudang) {
      const [balances, committed] = await Promise.all([
        getBalances(doc.gudang._id, skuIds),
        committedQty(doc.gudang._id, skuIds, { excludeSo: doc._id }),
      ]);
      doc.lines.forEach((l) => {
        if (!l.sku) return;
        const id = String(l.sku._id);
        l.currentQty = balances.get(id) || 0;
        l.committed = committed.get(id) || 0;
        l.available = round2(l.currentQty - l.committed);
      });
    }

    // posisi kredit customer (tanpa SO ini) untuk peringatan sebelum konfirmasi
    if (doc.status === 'DRAFT' && doc.customer) doc.credit = await customerCredit(doc.customer._id, { excludeSo: doc._id });

    if (doc.status !== 'DRAFT') {
      doc.deliveries = await DeliveryOrder.find({ salesOrder: doc._id })
        .select('no date status deliveryMethod invoice postedDate')
        .populate('invoice', 'no status')
        .sort({ createdDate: 1 }).lean();
      doc.invoices = await SalesInvoice.find({ salesOrders: doc._id })
        .select('no date status total paymentStatus deliveryOrders')
        .sort({ createdDate: 1 }).lean();
    }

    doc.canSeeCost = canSeeCostOf(req);
    if (doc.canSeeCost) {
      const skus = await ProdukSku.find({ _id: { $in: skuIds } }).select('avgCost').lean();
      const avg = new Map(skus.map((s) => [String(s._id), s.avgCost ?? null]));
      let cogs = 0;
      let missing = false;
      doc.lines.forEach((l) => {
        l.unitCost = l.sku ? avg.get(String(l.sku._id)) ?? null : null;
        l.netRevenue = netLineRevenue(l, doc);
        if (l.unitCost === null) {
          l.cost = null;
          l.margin = null;
          missing = true;
        } else {
          l.cost = round2(l.qty * l.unitCost);
          l.margin = round2(l.netRevenue - l.cost);
          cogs += l.cost;
        }
      });
      doc.cogs = missing && !cogs ? null : round2(cogs);
      doc.grossProfit = doc.cogs === null ? null : round2(doc.dpp - doc.cogs);
      doc.costMissing = missing;
    }
    return successResponse(res, doc);
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * GET /api/sales-order/skus?gudang=&customer=&search= — SKU aktif untuk baris SO:
 * + qty (stok gudang), committed (dipesan SO OPEN/PARTIAL), available, hargaJual & priceSource [+ avgCost].
 */
exports.searchSkus = async (req, res) => {
  try {
    const { gudang } = req.query;
    const validGudang = gudang && mongoose.isValidObjectId(gudang);
    if (validGudang) assertGudang(req, gudang);
    const q = String(req.query.search || '').trim();
    if (!q) return successResponse(res, []);
    const rx = { $regex: escapeRegex(q), $options: 'i' };
    const produkIds = await Produk.find({ name: rx }).distinct('_id');
    const skus = await ProdukSku.find({ isActive: true, $or: [{ sku: rx }, { barcode: q }, { produk: { $in: produkIds } }] })
      .select('sku produk variantValues isActive hargaJual avgCost')
      .populate({ path: 'produk', select: 'name uom', populate: { path: 'uom', select: 'code' } })
      .sort({ sku: 1 })
      .limit(20)
      .lean();
    const ids = skus.map((s) => s._id);
    const [balances, committed, prices] = await Promise.all([
      validGudang ? getBalances(gudang, ids) : new Map(),
      validGudang ? committedQty(gudang, ids, { excludeSo: mongoose.isValidObjectId(req.query.exclude) ? req.query.exclude : null }) : new Map(),
      resolvePrices(req.query.customer, ids),
    ]);
    const canSeeCost = canSeeCostOf(req);
    return successResponse(res, skus.map((s) => {
      const id = String(s._id);
      const qty = balances.get(id) || 0;
      const com = committed.get(id) || 0;
      return {
        _id: s._id,
        sku: s.sku,
        isActive: true,
        variant: (s.variantValues || []).map((v) => v.value).join(' / ') || 'Default',
        produk: s.produk ? { _id: s.produk._id, name: s.produk.name } : null,
        uom: s.produk?.uom?.code || '',
        qty,
        committed: com,
        available: round2(qty - com),
        hargaJual: prices.get(id)?.price ?? s.hargaJual ?? 0,
        priceSource: prices.get(id)?.source || 'default',
        ...(canSeeCost ? { avgCost: s.avgCost ?? null } : {}),
      };
    }));
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * POST /api/sales-order/skus/availability  body: { gudang, skus, exclude? } -> { skuId: { qty, committed, available } }
 * (dipakai saat gudang draft diganti)
 */
exports.skuAvailability = async (req, res) => {
  try {
    const { gudang } = req.body;
    if (!mongoose.isValidObjectId(gudang)) return errorResponse(res, 'Invalid warehouse', 400);
    assertGudang(req, gudang);
    const ids = (Array.isArray(req.body.skus) ? req.body.skus : []).filter((id) => mongoose.isValidObjectId(id));
    if (ids.length > MAX_LINES) return errorResponse(res, `At most ${MAX_LINES} SKUs`, 400);
    const [balances, committed] = await Promise.all([
      getBalances(gudang, ids),
      committedQty(gudang, ids, { excludeSo: mongoose.isValidObjectId(req.body.exclude) ? req.body.exclude : null }),
    ]);
    return successResponse(res, Object.fromEntries(ids.map((id) => {
      const qty = balances.get(String(id)) || 0;
      const com = committed.get(String(id)) || 0;
      return [String(id), { qty, committed: com, available: round2(qty - com) }];
    })));
  } catch (error) {
    return handleError(res, error);
  }
};

/** GET /api/sales-order/ship-to/:customerId — alamat kirim default (alamat customer) + termin, untuk form SO */
exports.getCustomerShipTo = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.customerId)) return errorResponse(res, 'Invalid customer', 400);
    const c = await Customer.findById(req.params.customerId)
      .select('name phone address provinsi kota kecamatan kodePos latitude longitude termDays').lean();
    if (!c) return errorResponse(res, 'Customer not found', 404);
    const excludeSo = mongoose.isValidObjectId(req.query.exclude) ? req.query.exclude : null;
    const credit = await customerCredit(c._id, { excludeSo });
    return successResponse(res, { shipTo: customerShipTo(c), termDays: c.termDays || 0, credit });
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- draft / confirm

/** POST /api/sales-order  body: { ...SO, confirm?: true } -> draft, atau langsung OPEN */
exports.createSalesOrder = async (req, res) => {
  try {
    const parsed = parseSo(req.body);
    assertGudang(req, parsed.gudang);
    const doc = await runInTransaction(async () => {
      const { customer } = await resolveRefs(parsed);
      await applyPrices(parsed);
      const doc = new SalesOrder({ no: await nextDocNo('SO'), createdBy: req.user._id });
      const settings = await getSettings();
      fillSo(doc, parsed, settings, customer);
      if (req.body.confirm === true) await confirm(doc, req, settings);
      await doc.save();
      await audit.logCreate(req, 'salesOrder', [doc]);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} ${doc.status === 'OPEN' ? 'confirmed' : 'saved as draft'}`, 201);
  } catch (error) {
    return handleError(res, error);
  }
};

/** PUT /api/sales-order/:id  body: { ...SO, confirm?: true } — hanya DRAFT */
exports.updateSalesOrder = async (req, res) => {
  try {
    const doc = await runInTransaction(async () => {
      const doc = await loadDraft(req, req.params.id);
      const parsed = parseSo(req.body);
      assertGudang(req, parsed.gudang);
      const { customer } = await resolveRefs(parsed);
      await applyPrices(parsed, await quotationPrices(doc.quotation));
      const before = await audit.snap('salesOrder', [doc]);
      const settings = await getSettings();
      fillSo(doc, parsed, settings, customer);
      if (req.body.confirm === true) await confirm(doc, req, settings);
      doc.updatedDate = new Date();
      doc.updatedBy = req.user._id;
      await doc.save();
      await audit.logUpdate(req, 'salesOrder', before, [doc]);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} ${doc.status === 'OPEN' ? 'confirmed' : 'successfully updated'}`);
  } catch (error) {
    return handleError(res, error);
  }
};

/** POST /api/sales-order/:id/confirm — konfirmasi draft tanpa perubahan isi (referensi dicek ulang) */
exports.confirmSalesOrder = async (req, res) => {
  try {
    const doc = await runInTransaction(async () => {
      const doc = await loadDraft(req, req.params.id);
      if (!doc.lines.length) throw new HttpError('Sales order has no lines', 400);
      await resolveRefs({ customer: String(doc.customer), gudang: String(doc.gudang), lines: doc.lines.map((l) => ({ sku: String(l.sku) })) });
      const before = await audit.snap('salesOrder', [doc]);
      await confirm(doc, req);
      await doc.save();
      await audit.logUpdate(req, 'salesOrder', before, [doc]);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} confirmed`);
  } catch (error) {
    return handleError(res, error);
  }
};

// DELETE /api/sales-order/:id — hanya DRAFT
exports.deleteSalesOrder = async (req, res) => {
  try {
    const doc = await runInTransaction(async () => {
      const doc = await loadDraft(req, req.params.id);
      const before = await audit.snap('salesOrder', [doc]);
      await doc.deleteOne();
      await audit.logDelete(req, 'salesOrder', before);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} successfully deleted`);
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- cancel / close

/** Draft DO untuk SO ini harus dihapus / diposting dulu (kunci SO: bentrok dengan pembuatan DO) */
const assertNoDraftDelivery = async (so) => {
  await lock(ref('salesOrder', so._id));
  const drafts = await DeliveryOrder.find({ salesOrder: so._id, status: 'DRAFT' }).select('no').lean();
  if (drafts.length) throw new HttpError(`Delete or post the draft delivery order(s) first: ${drafts.map((d) => d.no).join(', ')}`, 400);
};

const loadSo = async (req, id) => {
  if (!mongoose.isValidObjectId(id)) throw new HttpError('Sales order not found', 404);
  const doc = await SalesOrder.findById(id);
  if (!doc) throw new HttpError('Sales order not found', 404);
  assertGudang(req, doc.gudang);
  return doc;
};

/** POST /api/sales-order/:id/cancel  body: { reason } — hanya OPEN (belum ada pengiriman) */
exports.cancelSalesOrder = async (req, res) => {
  try {
    const reason = trimText(req.body.reason);
    if (!reason) return errorResponse(res, 'Cancellation reason is required', 400);
    const doc = await runInTransaction(async () => {
      const doc = await loadSo(req, req.params.id);
      if (doc.status !== 'OPEN') {
        throw new HttpError(doc.status === 'PARTIAL'
          ? 'Some goods have already been delivered. Close the sales order instead.'
          : doc.status === 'DRAFT' ? 'Draft sales orders are deleted, not cancelled'
            : `Sales order is ${doc.status.toLowerCase()} and cannot be cancelled`, 400);
      }
      await assertNoDraftDelivery(doc);
      const before = await audit.snap('salesOrder', [doc]);
      doc.status = 'CANCELLED';
      doc.cancelReason = reason;
      doc.cancelledBy = req.user._id;
      doc.cancelledDate = new Date();
      await doc.save();
      await audit.logUpdate(req, 'salesOrder', before, [doc]);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} cancelled`);
  } catch (error) {
    return handleError(res, error);
  }
};

/** POST /api/sales-order/:id/close  body: { reason } — PARTIAL: sisa tidak akan dikirim */
exports.closeSalesOrder = async (req, res) => {
  try {
    const reason = trimText(req.body.reason);
    if (!reason) return errorResponse(res, 'Reason is required', 400);
    const doc = await runInTransaction(async () => {
      const doc = await loadSo(req, req.params.id);
      if (doc.status !== 'PARTIAL') {
        throw new HttpError(doc.status === 'OPEN'
          ? 'Nothing has been delivered yet. Cancel the sales order instead.'
          : `Sales order is ${doc.status.toLowerCase()} and cannot be closed`, 400);
      }
      await assertNoDraftDelivery(doc);
      const before = await audit.snap('salesOrder', [doc]);
      doc.status = 'CLOSED';
      doc.closeReason = reason;
      doc.closedBy = req.user._id;
      doc.closedDate = new Date();
      await doc.save();
      await audit.logUpdate(req, 'salesOrder', before, [doc]);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} closed`);
  } catch (error) {
    return handleError(res, error);
  }
};
