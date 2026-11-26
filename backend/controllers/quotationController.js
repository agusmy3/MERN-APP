const mongoose = require('mongoose');
const Quotation = require('../models/Quotation');
const Customer = require('../models/Customer');
const ProdukSku = require('../models/ProdukSku');
const Gudang = require('../models/Gudang');
const { hasPermission } = require('../config/permissions');
const { successResponse, errorResponse } = require('../helpers/responseHelper');
const audit = require('../helpers/auditLogger');
const { runInTransaction, HttpError, lock, ref } = require('../helpers/transaction');
const { nextDocNo } = require('../helpers/stockHelper');
const { getSettings } = require('../helpers/settings');
const { checkAmount, round2 } = require('../helpers/number');
const { salesLineSubtotal, salesTotals } = require('../helpers/salesHelper');
const { loadUnits, applyUnits, resolveUnitPrices, priceForLine, unitOptions } = require('../helpers/packageHelper');
const { MAX_LINES } = require('../config/stock');
const { createDraftFromQuotation } = require('./salesOrderController');

/**
 * Quotation / penawaran harga. Alur & aturan harga: lihat models/Quotation.js.
 * Izin resource `quotation`: create = draft; update = ubah draft, kirim, revisi, tolak, konversi
 * (konversi butuh juga salesOrder:create); delete = hapus draft.
 */
const STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'];
const SORTABLE_FIELDS = ['no', 'date', 'validUntil', 'total', 'createdDate', 'updatedDate'];
const METHODS = ['DELIVERY', 'PICKUP'];
const DAY = 24 * 60 * 60 * 1000;
const DEFAULT_VALID_DAYS = 14;

const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status, error.details);
  if (error.name === 'ValidationError' || error.name === 'CastError') return errorResponse(res, error.message, 400);
  return errorResponse(res, error.message, 500);
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const trimText = (v, max = 500) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
/** SENT yang masa berlakunya sudah lewat (validUntil = hari terakhir berlaku) */
const isExpired = (q) => q.status === 'SENT' && startOfDay(q.validUntil) < startOfDay(new Date());

/** Validasi isi quotation dari body (murni). Harga diisi applyPrices. */
const parseQuotation = (body) => {
  if (!mongoose.isValidObjectId(body.customer)) throw new HttpError('Please select a customer', 400);
  if (!mongoose.isValidObjectId(body.gudang)) throw new HttpError('Please select a warehouse', 400);
  const date = body.date ? new Date(body.date) : new Date();
  if (Number.isNaN(date.getTime())) throw new HttpError('Invalid quotation date', 400);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  if (date > endOfToday) throw new HttpError('Quotation date cannot be in the future', 400);
  const validUntil = body.validUntil ? new Date(body.validUntil) : new Date(startOfDay(date).getTime() + DEFAULT_VALID_DAYS * DAY);
  if (Number.isNaN(validUntil.getTime())) throw new HttpError('Invalid valid-until date', 400);
  if (startOfDay(validUntil) < startOfDay(date)) throw new HttpError('Valid-until date cannot be before the quotation date', 400);

  const deliveryMethod = body.deliveryMethod === undefined || body.deliveryMethod === null ? 'DELIVERY' : body.deliveryMethod;
  if (!METHODS.includes(deliveryMethod)) throw new HttpError('Invalid delivery method', 400);

  const amount = (v, label, max) => {
    const value = v === undefined || v === null || v === '' ? 0 : v;
    const err = checkAmount(value, label);
    if (err) throw new HttpError(err, 400);
    const n = round2(value);
    if (max !== undefined && n > max) throw new HttpError(`${label} must be <= ${max}`, 400);
    return n;
  };
  const taxRate = body.taxRate === undefined || body.taxRate === null || body.taxRate === '' ? undefined : amount(body.taxRate, 'Tax rate', 100);
  const priceIncludesTax = body.priceIncludesTax === undefined || body.priceIncludesTax === null ? undefined : body.priceIncludesTax === true;

  const input = Array.isArray(body.lines) ? body.lines : [];
  if (!input.length) throw new HttpError('Add at least one item', 400);
  if (input.length > MAX_LINES) throw new HttpError(`A quotation can have at most ${MAX_LINES} lines`, 400);
  const lines = input.map((l, i) => {
    const n = `Line ${i + 1}`;
    if (!mongoose.isValidObjectId(l?.sku)) throw new HttpError(`${n}: invalid SKU`, 400);
    if (l.uom && !mongoose.isValidObjectId(l.uom)) throw new HttpError(`${n}: invalid unit`, 400);
    const err = checkAmount(l.qty, 'Quantity', { min: 0, exclusive: true }) || checkAmount(l.diskonPersen ?? 0, 'Discount');
    if (err) throw new HttpError(`${n}: ${err}`, 400);
    const diskonPersen = round2(l.diskonPersen ?? 0);
    if (diskonPersen > 100) throw new HttpError(`${n}: Discount must be <= 100`, 400);
    return { sku: String(l.sku), uom: l.uom ? String(l.uom) : null, qty: round2(l.qty), hargaJual: null, diskonPersen, note: trimText(l.note, 200) || undefined };
  });

  return {
    customer: String(body.customer),
    prospectName: trimText(body.prospectName, 120),
    prospectContact: trimText(body.prospectContact, 120),
    gudang: String(body.gudang),
    date,
    validUntil,
    deliveryMethod,
    taxRate,
    priceIncludesTax,
    discountAmount: amount(body.discountAmount, 'Document discount'),
    shippingCharge: deliveryMethod === 'PICKUP' ? 0 : amount(body.shippingCharge, 'Shipping charge'),
    note: trimText(body.note),
    terms: trimText(body.terms, 2000),
    lines,
  };
};

/** Referensi (di dalam transaksi, dikunci): customer aktif (walk-in boleh), gudang & SKU aktif; harga dibekukan */
const resolveAndPrice = async (parsed) => {
  const skuIds = parsed.lines.map((l) => l.sku);
  const skus = await ProdukSku.find({ _id: { $in: skuIds } }).select('sku produk isActive').lean();
  await lock(ref('customer', parsed.customer), ref('gudang', parsed.gudang),
    [...new Set(skus.map((s) => String(s.produk)))].map((id) => ref('produk', id)));
  const customer = await Customer.findById(parsed.customer).select('name isActive isWalkIn').lean();
  if (!customer) throw new HttpError('Please select a valid customer', 400);
  if (customer.isActive === false) throw new HttpError(`Customer ${customer.name} is inactive`, 400);
  if (customer.isWalkIn && !parsed.prospectName) throw new HttpError('Fill in the prospect name for a walk-in quotation', 400);
  if (!customer.isWalkIn) {
    parsed.prospectName = '';
    parsed.prospectContact = '';
  }
  const gudang = await Gudang.findById(parsed.gudang).select('code isActive').lean();
  if (!gudang) throw new HttpError('Please select a valid warehouse', 400);
  if (gudang.isActive === false) throw new HttpError(`Warehouse ${gudang.code} is inactive`, 400);
  if (skus.length !== new Set(skuIds).size) throw new HttpError('One or more SKUs no longer exist', 400);
  const inactive = skus.find((s) => s.isActive === false);
  if (inactive) throw new HttpError(`${inactive.sku} is inactive and cannot be quoted`, 400);
  applyUnits(parsed.lines, await loadUnits(skuIds));
  const prices = await resolveUnitPrices(parsed.customer, parsed.lines.map((l) => ({ sku: l.sku, uom: l.uom })));
  parsed.lines.forEach((l) => {
    l.hargaJual = round2(priceForLine(prices, l) ?? 0);
    l.subtotal = salesLineSubtotal(l);
  });
  const subtotal = round2(parsed.lines.reduce((s, l) => s + l.subtotal, 0));
  if (parsed.discountAmount > subtotal) throw new HttpError('Document discount cannot exceed the subtotal', 400);
};

const fill = (doc, parsed, settings) => {
  ['customer', 'prospectName', 'prospectContact', 'gudang', 'date', 'validUntil', 'deliveryMethod', 'note', 'terms', 'lines', 'discountAmount', 'shippingCharge']
    .forEach((k) => { doc[k] = parsed[k]; });
  if (parsed.taxRate !== undefined) doc.taxRate = parsed.taxRate;
  else if (doc.isNew) doc.taxRate = settings['tax.isPKP'] !== false ? (settings['tax.ppnRate'] ?? 0) : 0;
  if (parsed.priceIncludesTax !== undefined) doc.priceIncludesTax = parsed.priceIncludesTax;
  else if (doc.isNew) doc.priceIncludesTax = settings['sales.priceIncludesTax'] === true;
  Object.assign(doc, salesTotals(parsed.lines, doc));
};

const populateQuotation = (query) => query
  .populate('customer', 'code name phone email address provinsi kota kecamatan kodePos npwp termDays isWalkIn isActive')
  .populate('gudang', 'code name isActive')
  .populate('lines.sku', 'sku variantValues isActive hargaJual')
  .populate({ path: 'lines.produk', select: 'name uom', populate: { path: 'uom', select: 'code' } })
  .populate('lines.uom', 'code')
  .populate('salesOrder', 'no status')
  .populate('createdBy', 'name')
  .populate('updatedBy', 'name')
  .populate('sentBy', 'name')
  .populate('acceptedBy', 'name')
  .populate('rejectedBy', 'name');

const loadQuotation = async (id) => {
  if (!mongoose.isValidObjectId(id)) throw new HttpError('Quotation not found', 404);
  const doc = await Quotation.findById(id);
  if (!doc) throw new HttpError('Quotation not found', 404);
  return doc;
};

const loadDraft = async (id) => {
  const doc = await loadQuotation(id);
  if (doc.status !== 'DRAFT') throw new HttpError('Only draft quotations can be changed. Revise it first.', 400);
  return doc;
};

// ---------------------------------------------------------------- baca

/**
 * GET /api/quotation — daftar (tanpa baris). status=EXPIRED -> SENT yang lewat masa berlaku; SENT -> yang masih berlaku.
 * Query: search (no / customer / calon pembeli / catatan), status, customer, from, to, paginasi. + lineCount, expired.
 */
exports.getQuotations = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || 1) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || 10) || 10, 1), 100);
    const sortField = SORTABLE_FIELDS.includes(req.query.sortField) ? req.query.sortField : 'createdDate';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const filter = {};
    const today = startOfDay(new Date());
    if (req.query.status === 'EXPIRED') Object.assign(filter, { status: 'SENT', validUntil: { $lt: today } });
    else if (req.query.status === 'SENT') Object.assign(filter, { status: 'SENT', validUntil: { $gte: today } });
    else if (STATUSES.includes(req.query.status)) filter.status = req.query.status;
    if (req.query.customer) {
      if (!mongoose.isValidObjectId(req.query.customer)) return errorResponse(res, 'Invalid customer', 400);
      filter.customer = req.query.customer;
    }
    if (req.query.from || req.query.to) {
      filter.date = {};
      if (req.query.from) filter.date.$gte = new Date(`${req.query.from}T00:00:00`);
      if (req.query.to) filter.date.$lte = new Date(`${req.query.to}T23:59:59.999`);
    }
    if (req.query.search) {
      const rx = { $regex: escapeRegex(req.query.search), $options: 'i' };
      const customers = await Customer.find({ $or: [{ name: rx }, { code: rx }] }).distinct('_id');
      filter.$or = [{ no: rx }, { prospectName: rx }, { note: rx }, { customer: { $in: customers } }];
    }
    const [totalData, rows] = await Promise.all([
      Quotation.countDocuments(filter),
      Quotation.find(filter)
        .select('-lines')
        .populate('customer', 'code name isWalkIn')
        .populate('gudang', 'code')
        .populate('salesOrder', 'no status')
        .populate('createdBy', 'name')
        .populate('updatedBy', 'name')
        .sort({ [sortField]: sortOrder, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);
    const counts = await Quotation.aggregate([
      { $match: { _id: { $in: rows.map((r) => r._id) } } },
      { $project: { lineCount: { $size: '$lines' } } },
    ]);
    const countOf = new Map(counts.map((c) => [String(c._id), c.lineCount]));
    rows.forEach((r) => {
      r.lineCount = countOf.get(String(r._id)) || 0;
      r.expired = isExpired(r);
    });
    return successResponse(res, { dataQuotation: rows, totalData, currentPage: page, totalPages: Math.ceil(totalData / pageSize) });
  } catch (error) {
    return handleError(res, error);
  }
};

/** GET /api/quotation/:id — lengkap + expired, canConvert */
exports.getQuotation = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 'Quotation not found', 404);
    const doc = await populateQuotation(Quotation.findById(req.params.id)).lean();
    if (!doc) return errorResponse(res, 'Quotation not found', 404);
    doc.expired = isExpired(doc);
    if (doc.status === 'DRAFT') {
      const opts = await unitOptions(doc.customer?._id, doc.lines.map((l) => l.sku?._id ?? l.sku));
      doc.lines.forEach((l) => { l.units = opts.get(String(l.sku?._id ?? l.sku)) || []; });
    }
    return successResponse(res, doc);
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- draft

/** POST /api/quotation  body: { ...quotation, send?: true } */
exports.createQuotation = async (req, res) => {
  try {
    const parsed = parseQuotation(req.body);
    const doc = await runInTransaction(async () => {
      await resolveAndPrice(parsed);
      const doc = new Quotation({ no: await nextDocNo('QUO'), createdBy: req.user._id });
      fill(doc, parsed, await getSettings());
      if (req.body.send === true) Object.assign(doc, { status: 'SENT', sentBy: req.user._id, sentDate: new Date() });
      await doc.save();
      await audit.logCreate(req, 'quotation', [doc]);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} ${doc.status === 'SENT' ? 'sent' : 'saved as draft'}`, 201);
  } catch (error) {
    return handleError(res, error);
  }
};

/** PUT /api/quotation/:id  body: { ...quotation, send?: true } — hanya DRAFT; harga dihitung ulang */
exports.updateQuotation = async (req, res) => {
  try {
    const parsed = parseQuotation(req.body);
    const doc = await runInTransaction(async () => {
      const doc = await loadDraft(req.params.id);
      await resolveAndPrice(parsed);
      const before = await audit.snap('quotation', [doc]);
      fill(doc, parsed, await getSettings());
      if (req.body.send === true) Object.assign(doc, { status: 'SENT', sentBy: req.user._id, sentDate: new Date() });
      doc.updatedDate = new Date();
      doc.updatedBy = req.user._id;
      await doc.save();
      await audit.logUpdate(req, 'quotation', before, [doc]);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} ${doc.status === 'SENT' ? 'sent' : 'successfully updated'}`);
  } catch (error) {
    return handleError(res, error);
  }
};

/** DELETE /api/quotation/:id — hanya DRAFT */
exports.deleteQuotation = async (req, res) => {
  try {
    const doc = await runInTransaction(async () => {
      const doc = await loadDraft(req.params.id);
      const before = await audit.snap('quotation', [doc]);
      await doc.deleteOne();
      await audit.logDelete(req, 'quotation', before);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} successfully deleted`);
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- status

/** Ubah status 1 quotation dengan audit (di dalam transaksi). check(doc) melempar HttpError jika tidak boleh. */
const transition = (check, apply, message) => async (req, res) => {
  try {
    const doc = await runInTransaction(async () => {
      const doc = await loadQuotation(req.params.id);
      await lock(ref('quotation', doc._id));
      const before = await audit.snap('quotation', [doc]);
      await check(doc, req);
      await apply(doc, req);
      doc.updatedDate = new Date();
      doc.updatedBy = req.user._id;
      await doc.save();
      await audit.logUpdate(req, 'quotation', before, [doc]);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} ${message}`);
  } catch (error) {
    return handleError(res, error);
  }
};

/** POST /api/quotation/:id/send — DRAFT -> SENT (harga dikunci); referensi dicek ulang & harga dihitung ulang */
exports.sendQuotation = transition(
  async (doc) => {
    if (doc.status !== 'DRAFT') throw new HttpError(`Quotation is already ${doc.status.toLowerCase()}`, 400);
    if (startOfDay(doc.validUntil) < startOfDay(new Date())) throw new HttpError('Valid-until date has passed. Change it first.', 400);
    const parsed = {
      customer: String(doc.customer), prospectName: doc.prospectName, prospectContact: doc.prospectContact, gudang: String(doc.gudang),
      discountAmount: doc.discountAmount, lines: doc.lines.map((l) => ({ sku: String(l.sku), uom: l.uom, qty: l.qtyUom ?? l.qty, diskonPersen: l.diskonPersen, note: l.note })),
    };
    await resolveAndPrice(parsed);
    doc.lines = parsed.lines;
    Object.assign(doc, salesTotals(parsed.lines, doc));
  },
  (doc, req) => Object.assign(doc, { status: 'SENT', sentBy: req.user._id, sentDate: new Date() }),
  'sent',
);

/** POST /api/quotation/:id/revise — SENT (juga kedaluwarsa) -> DRAFT untuk diubah / diperpanjang */
exports.reviseQuotation = transition(
  (doc) => { if (doc.status !== 'SENT') throw new HttpError('Only sent quotations can be revised', 400); },
  (doc) => Object.assign(doc, { status: 'DRAFT', sentBy: null, sentDate: null }),
  'reopened as draft',
);

/** POST /api/quotation/:id/reject  body: { reason } — SENT -> REJECTED */
exports.rejectQuotation = transition(
  (doc, req) => {
    if (doc.status !== 'SENT') throw new HttpError('Only sent quotations can be marked as rejected', 400);
    if (!trimText(req.body?.reason)) throw new HttpError('Reason is required', 400);
  },
  (doc, req) => Object.assign(doc, { status: 'REJECTED', rejectReason: trimText(req.body.reason), rejectedBy: req.user._id, rejectedDate: new Date() }),
  'marked as rejected',
);

/**
 * POST /api/quotation/:id/convert  body: { customer? } — SENT & masih berlaku -> Sales Order DRAFT (harga penawaran)
 * + quotation ACCEPTED. Quotation walk-in: body.customer (customer bernama) wajib. Butuh juga salesOrder:create.
 */
exports.convertQuotation = async (req, res) => {
  try {
    if (!hasPermission(req.user, 'salesOrder', 'create')) return errorResponse(res, "You don't have permission to create sales orders", 403);
    const result = await runInTransaction(async () => {
      const doc = await loadQuotation(req.params.id);
      await lock(ref('quotation', doc._id));
      if (doc.status !== 'SENT') {
        throw new HttpError(doc.status === 'DRAFT' ? 'Send the quotation before converting it' : `Quotation is already ${doc.status.toLowerCase()}`, 400);
      }
      if (isExpired(doc)) throw new HttpError('Quotation has expired. Revise it to extend the validity (prices are recalculated).', 400);
      const current = await Customer.findById(doc.customer).select('isWalkIn').lean();
      let customerId = doc.customer;
      if (current?.isWalkIn) {
        if (!mongoose.isValidObjectId(req.body?.customer)) throw new HttpError('Choose a named customer for this walk-in quotation', 400);
        customerId = req.body.customer;
      }
      const so = await createDraftFromQuotation(req, doc, customerId);
      const before = await audit.snap('quotation', [doc]);
      Object.assign(doc, { status: 'ACCEPTED', salesOrder: so._id, acceptedBy: req.user._id, acceptedDate: new Date(), updatedDate: new Date(), updatedBy: req.user._id });
      await doc.save();
      await audit.logUpdate(req, 'quotation', before, [doc]);
      return { quotation: doc, salesOrder: so };
    });
    return successResponse(res, result, `${result.quotation.no} converted to ${result.salesOrder.no}`, 201);
  } catch (error) {
    return handleError(res, error);
  }
};
