const mongoose = require('mongoose');
const VendorPrice = require('../models/VendorPrice');
const ProdukSku = require('../models/ProdukSku');
const Vendor = require('../models/Vendor');
const Uom = require('../models/Uom');
const {
  successResponse,
  errorResponse
} = require("../helpers/responseHelper");
const audit = require('../helpers/auditLogger');
const { checkAmount, round2 } = require('../helpers/number');
const { runInTransaction, HttpError, lock, ref } = require('../helpers/transaction');
const Produk = require('../models/Produk');
const { assertConvertible } = require('../helpers/uomHelper');

/** satuan beli harus bisa dikonversi ke satuan dasar tiap produk (lihat config/uom.js) */
const checkConversion = async (produkIds, uomBeli, konversi) => {
  const produks = await Produk.find({ _id: { $in: produkIds } }).select('name uom').lean();
  await lock(produks.map((p) => ref('uom', p.uom))); // bentrok dengan ganti jenis UoM dasar
  await assertConvertible(produks.map((p) => ({ purchaseId: uomBeli, baseId: p.uom, konversi, label: p.name })));
};

const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status);
  if (error.code === 11000) {
    return errorResponse(res, 'This vendor already has a price for this SKU in the same purchase UoM', 400);
  }
  if (error.name === 'ValidationError' || error.name === 'CastError') {
    return errorResponse(res, error.message, 400);
  }
  return errorResponse(res, error.message, 500);
};

// Validasi angka & referensi; return pesan error atau null
const validatePriceInput = async ({ vendor, uomBeli, konversi, hargaBeli, minOrder }) => {
  if (vendor !== undefined && (!mongoose.isValidObjectId(vendor) || !(await Vendor.exists({ _id: vendor })))) {
    return 'Please select a valid vendor';
  }
  if (uomBeli !== undefined && (!mongoose.isValidObjectId(uomBeli) || !(await Uom.exists({ _id: uomBeli })))) {
    return 'Please select a valid purchase UoM';
  }
  // angka maks. 2 desimal (helpers/number.js)
  return (konversi !== undefined && checkAmount(konversi, 'Conversion', { min: 0, exclusive: true }))
    || (hargaBeli !== undefined && checkAmount(hargaBeli, 'Purchase price'))
    || (minOrder !== undefined && minOrder !== null && minOrder !== '' && checkAmount(minOrder, 'Minimum order'))
    || null;
};

const toMinOrder = (v) => (v === undefined || v === null || v === '' ? null : round2(v));

// Hanya 1 vendor utama (isPreferred) per SKU. Harga lain yang kehilangan status ikut dicatat di audit.
const clearOtherPreferred = async (req, skuIds, keepIds, batchId) => {
  const filter = { sku: { $in: skuIds }, _id: { $nin: keepIds }, isPreferred: true };
  const affected = await VendorPrice.find(filter).lean();
  if (!affected.length) return;
  const before = await audit.snap('vendorPrice', affected);
  await VendorPrice.updateMany(filter, { isPreferred: false, updatedDate: new Date(), updatedBy: req.user._id });
  const after = await VendorPrice.find({ _id: { $in: affected.map((a) => a._id) } }).lean();
  await audit.logUpdate(req, 'vendorPrice', before, after, { batchId });
};

const populatePrice = (query) => query
  .populate('vendor', 'companyName')
  .populate('produk', 'name')
  .populate({ path: 'sku', select: 'sku variantValues isActive', populate: { path: 'variantValues.variant', select: 'code name' } })
  .populate('uomBeli', 'code name')
  .populate('createdBy', 'name')
  .populate('updatedBy', 'name');

/**
 * GET /api/vendor-price?produk=<id>  atau  ?vendor=<id>  (salah satu wajib)
 * Setiap baris ditambah hargaPerUnit = hargaBeli / konversi (harga per satuan dasar produk).
 */
exports.getVendorPrice = async (req, res) => {
  try {
    const filter = {};
    for (const key of ['produk', 'vendor', 'sku']) {
      if (req.query[key]) {
        if (!mongoose.isValidObjectId(req.query[key])) return errorResponse(res, `Invalid ${key}`, 400);
        filter[key] = req.query[key];
      }
    }
    if (!filter.produk && !filter.vendor && !filter.sku) {
      return errorResponse(res, 'Filter produk, vendor, or sku is required', 400);
    }

    const rows = await populatePrice(VendorPrice.find(filter)).lean();
    const data = rows
      .map((r) => ({ ...r, hargaPerUnit: r.hargaBeli / r.konversi }))
      .sort((a, b) => String(a.sku?.sku).localeCompare(String(b.sku?.sku)) || a.hargaPerUnit - b.hargaPerUnit);

    return successResponse(res, data);
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * POST /api/vendor-price — tambah harga untuk 1 atau banyak SKU sekaligus ("terapkan ke semua varian")
 * body: { vendor, skus: [skuId, ...], uomBeli, konversi, hargaBeli, isPreferred, minOrder, catatan }
 * Jika vendor + SKU + uomBeli sudah punya harga, harganya diperbarui (bukan dobel).
 */
exports.createVendorPrice = async (req, res) => {
  try {
    const { vendor, uomBeli, konversi, hargaBeli, isPreferred, minOrder, catatan } = req.body;
    const skuIds = [...new Set((Array.isArray(req.body.skus) ? req.body.skus : []).map(String))]
      .filter((id) => mongoose.isValidObjectId(id));

    if (!skuIds.length) return errorResponse(res, 'Please select at least one SKU', 400);
    if (konversi === undefined || hargaBeli === undefined) {
      return errorResponse(res, 'Conversion and purchase price are required', 400);
    }

    const { created, updated } = await runInTransaction(async () => {
      const inputError = await validatePriceInput({ vendor, uomBeli, konversi, hargaBeli, minOrder });
      if (inputError) throw new HttpError(inputError, 400);

      // vendor/UoM/produk tidak boleh terhapus bersamaan; vendor utama per SKU dikunci
      const owners = await ProdukSku.find({ _id: { $in: skuIds } }).select('produk').lean();
      await lock(
        ref('vendor', vendor), ref('uom', uomBeli),
        owners.map((s) => ref('produk', s.produk)),
        isPreferred ? skuIds.map((id) => `preferred:${id}`) : []
      );
      const skus = await ProdukSku.find({ _id: { $in: skuIds } }).select('produk').lean();
      if (skus.length !== skuIds.length) throw new HttpError('One or more SKUs are not valid', 400);
      await checkConversion([...new Set(skus.map((s) => String(s.produk)))], uomBeli, round2(konversi));

      // nilai lama (untuk audit) dari harga yang akan ditimpa oleh upsert
      const existing = await VendorPrice.find({ vendor, uomBeli, sku: { $in: skuIds } }).lean();
      const before = await audit.snap('vendorPrice', existing);
      const batchId = audit.newBatchId();

      const now = new Date();
      const result = await VendorPrice.bulkWrite(skus.map((s) => ({
        updateOne: {
          filter: { vendor, sku: s._id, uomBeli },
          update: {
            $set: {
              produk: s.produk,
              konversi: round2(konversi),
              hargaBeli: round2(hargaBeli),
              isPreferred: !!isPreferred,
              minOrder: toMinOrder(minOrder),
              catatan,
              updatedDate: now,
              updatedBy: req.user._id,
            },
            $setOnInsert: { createdDate: now, createdBy: req.user._id },
          },
          upsert: true,
        }
      })));

      // baris baru: updatedDate/By dikosongkan supaya audit "Created" tetap benar
      const insertedIds = Object.values(result.upsertedIds || {});
      if (insertedIds.length) {
        await VendorPrice.updateMany({ _id: { $in: insertedIds } }, { updatedDate: null, updatedBy: null });
      }

      const saved = await VendorPrice.find({ vendor, uomBeli, sku: { $in: skuIds } }).lean();
      await audit.logCreate(req, 'vendorPrice', saved.filter((p) => !before.has(String(p._id))), { batchId });
      await audit.logUpdate(req, 'vendorPrice', before, saved.filter((p) => before.has(String(p._id))), { batchId });

      if (isPreferred) {
        await clearOtherPreferred(req, skuIds, saved.map((p) => p._id), batchId);
      }
      return { created: result.upsertedCount || 0, updated: result.modifiedCount || 0 };
    });

    return successResponse(
      res,
      { created, updated },
      `Vendor price saved: ${created} added, ${updated} updated`,
      created ? 201 : 200
    );
  } catch (error) {
    return handleError(res, error);
  }
};

// PUT /api/vendor-price/:id — ubah 1 harga (vendor & SKU tetap)
exports.updateVendorPrice = async (req, res) => {
  try {
    const { uomBeli, konversi, hargaBeli, isPreferred, minOrder, catatan } = req.body;

    const price = await runInTransaction(async () => {
      const price = await VendorPrice.findById(req.params.id);
      if (!price) throw new HttpError('Vendor price not found', 404);

      await lock(
        ref('produk', price.produk), ref('uom', uomBeli),
        isPreferred ? `preferred:${price.sku}` : null
      );
      const inputError = await validatePriceInput({ uomBeli, konversi, hargaBeli, minOrder });
      if (inputError) throw new HttpError(inputError, 400);

      const before = await audit.snap('vendorPrice', [price]);
      const batchId = audit.newBatchId();

      if (uomBeli !== undefined) price.uomBeli = uomBeli;
      if (konversi !== undefined) price.konversi = round2(konversi);
      await checkConversion([price.produk], price.uomBeli, price.konversi);
      if (hargaBeli !== undefined) price.hargaBeli = round2(hargaBeli);
      if (isPreferred !== undefined) price.isPreferred = !!isPreferred;
      if (minOrder !== undefined) price.minOrder = toMinOrder(minOrder);
      price.catatan = catatan ?? price.catatan;
      price.updatedDate = new Date();
      price.updatedBy = req.user._id;
      await price.save();
      await audit.logUpdate(req, 'vendorPrice', before, [price], { batchId });

      // vendor utama tetap tepat 1 per SKU (dalam transaksi yang sama)
      if (price.isPreferred) await clearOtherPreferred(req, [price.sku], [price._id], batchId);
      return price;
    });

    return successResponse(res, price, "Vendor price successfully updated", 200);
  } catch (error) {
    return handleError(res, error);
  }
};

// DELETE /api/vendor-price/:id
exports.deleteVendorPrice = async (req, res) => {
  try {
    const price = await runInTransaction(async () => {
      const price = await VendorPrice.findById(req.params.id);
      if (!price) throw new HttpError('Vendor price not found', 404);

      await lock(ref('produk', price.produk));
      const before = await audit.snap('vendorPrice', [price]);
      await price.deleteOne();
      await audit.logDelete(req, 'vendorPrice', before);
      return price;
    });

    return successResponse(res, price, "Vendor price successfully deleted", 200);
  } catch (error) {
    return handleError(res, error);
  }
};
