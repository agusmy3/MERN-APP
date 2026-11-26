const mongoose = require('mongoose');
const PriceList = require('../models/PriceList');
const Customer = require('../models/Customer');
const ProdukSku = require('../models/ProdukSku');
const Produk = require('../models/Produk');
const { hasPermission } = require('../config/permissions');
const { successResponse, errorResponse } = require('../helpers/responseHelper');
const audit = require('../helpers/auditLogger');
const { runInTransaction, HttpError, lock, ref } = require('../helpers/transaction');
const { checkAmount, round2 } = require('../helpers/number');

const SORTABLE_FIELDS = ['code', 'name', 'createdDate', 'updatedDate'];
const MAX_ITEMS = 5000;

const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status);
  if (error.code === 11000) return errorResponse(res, 'Price list code already exists', 400);
  if (error.name === 'ValidationError' || error.name === 'CastError') return errorResponse(res, error.message, 400);
  return errorResponse(res, error.message, 500);
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Field header (hanya yang dikirim) */
const parseHeader = (body, isNew) => {
  const out = {};
  if (body.code !== undefined || isNew) {
    out.code = String(body.code || '').trim();
    if (!out.code) throw new HttpError('Price list code is required', 400);
  }
  if (body.name !== undefined || isNew) {
    out.name = String(body.name || '').trim().slice(0, 120);
    if (!out.name) throw new HttpError('Price list name is required', 400);
  }
  if (body.deskripsi !== undefined) out.deskripsi = String(body.deskripsi || '').trim().slice(0, 1000);
  if (body.isActive !== undefined) out.isActive = body.isActive !== false;
  return out;
};

/** items: [{ sku, uom?, price }] (uom kosong = satuan dasar; selain itu kemasan jual SKU) -> divalidasi & diisi produk */
const parseItems = async (input) => {
  if (!Array.isArray(input)) throw new HttpError('Items must be a list', 400);
  if (input.length > MAX_ITEMS) throw new HttpError(`A price list can have at most ${MAX_ITEMS} items`, 400);
  const seen = new Set();
  const items = input.map((it, i) => {
    const n = `Item ${i + 1}`;
    if (!mongoose.isValidObjectId(it?.sku)) throw new HttpError(`${n}: invalid SKU`, 400);
    if (it.uom && !mongoose.isValidObjectId(it.uom)) throw new HttpError(`${n}: invalid unit`, 400);
    const err = checkAmount(it.price, 'Price');
    if (err) throw new HttpError(`${n}: ${err}`, 400);
    return { sku: String(it.sku), uom: it.uom ? String(it.uom) : null, price: round2(it.price) };
  });
  const skus = await ProdukSku.find({ _id: { $in: items.map((i) => i.sku) } }).select('sku produk packages').populate('produk', 'uom').lean();
  if (skus.length !== new Set(items.map((i) => i.sku)).size) throw new HttpError('One or more SKUs no longer exist', 400);
  const skuById = new Map(skus.map((s) => [String(s._id), s]));
  items.forEach((it, i) => {
    const s = skuById.get(it.sku);
    if (it.uom && String(it.uom) === String(s.produk?.uom)) it.uom = null; // satuan dasar
    if (it.uom && !(s.packages || []).some((p) => String(p.uom) === String(it.uom))) throw new HttpError(`Item ${i + 1}: ${s.sku} has no selling package with that unit`, 400);
    const key = `${it.sku}:${it.uom || ''}`;
    if (seen.has(key)) throw new HttpError(`Item ${i + 1}: ${s.sku} appears more than once for the same unit`, 400);
    seen.add(key);
  });
  const owners = skus.map((s) => ({ _id: s._id, produk: s.produk?._id }));
  await lock([...new Set(owners.map((s) => String(s.produk)))].map((id) => ref('produk', id))); // bentrok dengan hapus SKU/produk
  const produkOf = new Map(owners.map((s) => [String(s._id), s.produk]));
  items.forEach((i) => { i.produk = produkOf.get(i.sku); });
  return items;
};

// GET /api/price-list — paginasi + jumlah item & customer
exports.getPriceLists = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || 1) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || 10) || 10, 1), 100);
    const sortField = SORTABLE_FIELDS.includes(req.query.sortField) ? req.query.sortField : 'createdDate';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const filter = {};
    if (req.query.search) {
      const rx = { $regex: escapeRegex(req.query.search), $options: 'i' };
      filter.$or = [{ code: rx }, { name: rx }, { deskripsi: rx }];
    }
    const [totalData, docs] = await Promise.all([
      PriceList.countDocuments(filter),
      PriceList.find(filter)
        .select('-items')
        .populate('createdBy', 'name')
        .populate('updatedBy', 'name')
        .collation({ locale: 'en', strength: 2 })
        .sort({ [sortField]: sortOrder })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);
    const ids = docs.map((d) => d._id);
    const [counts, customers] = await Promise.all([
      PriceList.aggregate([{ $match: { _id: { $in: ids } } }, { $project: { n: { $size: '$items' } } }]),
      Customer.aggregate([{ $match: { priceList: { $in: ids } } }, { $group: { _id: '$priceList', n: { $sum: 1 } } }]),
    ]);
    const itemMap = new Map(counts.map((c) => [String(c._id), c.n]));
    const custMap = new Map(customers.map((c) => [String(c._id), c.n]));
    docs.forEach((d) => {
      d.itemCount = itemMap.get(String(d._id)) || 0;
      d.customerCount = custMap.get(String(d._id)) || 0;
    });
    return successResponse(res, { dataPriceList: docs, totalData, currentPage: page, totalPages: Math.ceil(totalData / pageSize) });
  } catch (error) {
    return handleError(res, error);
  }
};

/** GET /api/price-list/:id — + items (SKU, produk, harga default, [HPP]) & customer yang memakai */
exports.getPriceList = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 'Price list not found', 404);
    const doc = await PriceList.findById(req.params.id)
      .populate({ path: 'items.sku', select: 'sku variantValues isActive hargaJual avgCost packages', populate: { path: 'packages.uom', select: 'code' } })
      .populate({ path: 'items.produk', select: 'name uom', populate: { path: 'uom', select: 'code' } })
      .populate('items.uom', 'code')
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .lean();
    if (!doc) return errorResponse(res, 'Price list not found', 404);
    const canSeeCost = hasPermission(req.user, 'vendorPrice', 'view');
    doc.items.forEach((it) => {
      if (!canSeeCost && it.sku) delete it.sku.avgCost;
      // kemasan: isi & harga default kemasan (kosong = isi x harga jual)
      const pkg = it.uom ? (it.sku?.packages || []).find((p) => String(p.uom?._id ?? p.uom) === String(it.uom._id)) : null;
      it.konversi = pkg?.konversi ?? 1;
      it.defaultPrice = pkg ? (pkg.hargaJual ?? round2((it.sku?.hargaJual || 0) * pkg.konversi)) : (it.sku?.hargaJual ?? 0);
    });
    doc.items.sort((a, b) => String(a.sku?.sku).localeCompare(String(b.sku?.sku)));
    doc.customers = await Customer.find({ priceList: doc._id }).select('code name isActive').sort({ name: 1 }).lean();
    doc.canSeeCost = canSeeCost;
    return successResponse(res, doc);
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * GET /api/price-list/skus?search=|produk=|kategori= — SKU untuk ditambahkan: + hargaJual (+ avgCost).
 * search maks. 20; produk / kategori = semua SKU-nya (maks. 2000).
 */
exports.searchSkus = async (req, res) => {
  try {
    const { search, produk, kategori } = req.query;
    const filter = {};
    let limit = 20;
    if (produk || kategori) {
      if (produk && !mongoose.isValidObjectId(produk)) return errorResponse(res, 'Invalid product', 400);
      if (kategori && !mongoose.isValidObjectId(kategori)) return errorResponse(res, 'Invalid category', 400);
      filter.produk = produk || { $in: await Produk.find({ kategori }).distinct('_id') };
      limit = 2000;
    } else if (search && String(search).trim()) {
      const rx = { $regex: escapeRegex(String(search).trim()), $options: 'i' };
      filter.$or = [{ sku: rx }, { produk: { $in: await Produk.find({ name: rx }).distinct('_id') } }];
    } else {
      return successResponse(res, []);
    }
    const canSeeCost = hasPermission(req.user, 'vendorPrice', 'view');
    const skus = await ProdukSku.find(filter)
      .select('sku produk variantValues isActive hargaJual avgCost packages')
      .populate({ path: 'produk', select: 'name uom', populate: { path: 'uom', select: 'code' } })
      .populate('packages.uom', 'code')
      .sort({ sku: 1 })
      .limit(limit)
      .lean();
    return successResponse(res, skus.map((s) => ({
      _id: s._id,
      sku: s.sku,
      isActive: s.isActive !== false,
      variant: (s.variantValues || []).map((v) => v.value).join(' / ') || 'Default',
      produk: s.produk ? { _id: s.produk._id, name: s.produk.name } : null,
      uom: s.produk?.uom?.code || '',
      hargaJual: s.hargaJual ?? 0,
      // kemasan jual aktif: [{ uom: { _id, code }, konversi, defaultPrice }]
      packages: (s.packages || []).filter((p) => p.isActive !== false)
        .map((p) => ({ uom: p.uom, konversi: p.konversi, defaultPrice: p.hargaJual ?? round2((s.hargaJual || 0) * p.konversi) })),
      ...(canSeeCost ? { avgCost: s.avgCost ?? null } : {}),
    })));
  } catch (error) {
    return handleError(res, error);
  }
};

// POST /api/price-list  body: { code, name, deskripsi, isActive, items? }
exports.createPriceList = async (req, res) => {
  try {
    const header = parseHeader(req.body, true);
    const doc = await runInTransaction(async () => {
      const items = req.body.items !== undefined ? await parseItems(req.body.items) : [];
      const doc = await PriceList.create({ ...header, items, createdBy: req.user._id });
      await audit.logCreate(req, 'priceList', [doc]);
      return doc;
    });
    return successResponse(res, doc, 'Price list successfully added', 201);
  } catch (error) {
    return handleError(res, error);
  }
};

// PUT /api/price-list/:id  body: header (parsial) + items (opsional, menggantikan seluruh item)
exports.updatePriceList = async (req, res) => {
  try {
    const header = parseHeader(req.body, false);
    const doc = await runInTransaction(async () => {
      const doc = await PriceList.findById(req.params.id);
      if (!doc) throw new HttpError('Price list not found', 404);
      await lock(ref('priceList', doc._id));
      const before = await audit.snap('priceList', [doc]);
      Object.assign(doc, header);
      if (req.body.items !== undefined) doc.items = await parseItems(req.body.items);
      doc.updatedDate = new Date();
      doc.updatedBy = req.user._id;
      await doc.save();
      await audit.logUpdate(req, 'priceList', before, [doc]);
      return doc;
    });
    return successResponse(res, doc, 'Price list successfully updated');
  } catch (error) {
    return handleError(res, error);
  }
};

// DELETE /api/price-list/:id — ditolak jika masih dipakai customer
exports.deletePriceList = async (req, res) => {
  try {
    const doc = await runInTransaction(async () => {
      const doc = await PriceList.findById(req.params.id);
      if (!doc) throw new HttpError('Price list not found', 404);
      await lock(ref('priceList', doc._id)); // bentrok dengan customer yang sedang ditautkan
      const used = await Customer.countDocuments({ priceList: doc._id });
      if (used) throw new HttpError(`Price list is used by ${used} customer(s). Unassign it first or deactivate it.`, 400);
      const before = await audit.snap('priceList', [doc]);
      await doc.deleteOne();
      await audit.logDelete(req, 'priceList', before);
      return doc;
    });
    return successResponse(res, doc, 'Price list successfully deleted');
  } catch (error) {
    return handleError(res, error);
  }
};
