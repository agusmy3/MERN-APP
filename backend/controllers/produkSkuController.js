const mongoose = require('mongoose');
const Produk = require('../models/Produk');
const ProdukSku = require('../models/ProdukSku');
const VendorPrice = require('../models/VendorPrice');
const {
  successResponse,
  errorResponse
} = require("../helpers/responseHelper");
const { buildComboKey, generateSkuCode, cartesian } = require('../helpers/skuHelper');
const { hasPermission } = require('../config/permissions');
const audit = require('../helpers/auditLogger');
const { runInTransaction, HttpError, lock, ref } = require('../helpers/transaction');
const { checkAmount, round2 } = require('../helpers/number');
const { skusWithStockHistory } = require('../helpers/stockHelper');

const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status);
  if (error.code === 11000) {
    return errorResponse(res, `SKU code ${error.keyValue?.sku || ''} already exists`, 400);
  }
  if (error.name === 'ValidationError' || error.name === 'CastError') {
    return errorResponse(res, error.message, 400);
  }
  return errorResponse(res, error.message, 500);
};

/**
 * Harga pokok per satuan dasar untuk tiap SKU, dari daftar harga vendor:
 * - minUnitCost  : termurah (hargaBeli / konversi)
 * - preferredUnitCost : dari vendor utama (isPreferred), jika ada
 */
const getUnitCosts = async (skuIds) => {
  const rows = await VendorPrice.aggregate([
    { $match: { sku: { $in: skuIds } } },
    { $project: { sku: 1, isPreferred: 1, unitCost: { $divide: ['$hargaBeli', '$konversi'] } } },
    {
      $group: {
        _id: '$sku',
        minUnitCost: { $min: '$unitCost' },
        preferredUnitCost: { $max: { $cond: ['$isPreferred', '$unitCost', null] } },
        priceCount: { $sum: 1 },
      }
    },
  ]);
  return new Map(rows.map((r) => [String(r._id), r]));
};

// GET /api/produk/:id/sku — semua SKU milik produk (+ harga pokok jika boleh lihat harga vendor)
exports.listSku = async (req, res) => {
  try {
    const skus = await ProdukSku.find({ produk: req.params.id })
      .populate('variantValues.variant', 'code name')
      .populate('packages.uom', 'code name')
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .sort({ sku: 1 })
      .lean();

    // harga beli = data sensitif: hanya dikirim jika user punya izin vendorPrice:view
    const canSeeCost = hasPermission(req.user, 'vendorPrice', 'view');
    if (!canSeeCost) skus.forEach((s) => { delete s.avgCost; }); // HPP = data biaya
    if (canSeeCost) {
      const costs = await getUnitCosts(skus.map((s) => s._id));
      skus.forEach((s) => {
        const c = costs.get(String(s._id));
        s.minUnitCost = c?.minUnitCost ?? null;
        s.preferredUnitCost = c?.preferredUnitCost ?? null;
        s.priceCount = c?.priceCount || 0;
      });
    }

    return successResponse(res, { skus, canSeeCost });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * POST /api/produk/:id/sku/generate
 * body: { selections: { <variantId>: ['Merah', 'Biru'], <variantId>: ['S', 'M'] } }
 * Membuat SKU untuk setiap kombinasi nilai yang dipilih; kombinasi yang sudah ada dilewati.
 * Produk tanpa varian: membuat SKU default jika belum ada.
 */
exports.generateSku = async (req, res) => {
  try {
    const createdCount = await runInTransaction(async () => {
      const produk = await Produk.findById(req.params.id).populate('variants', 'code name values');
      if (!produk) throw new HttpError('Product not found', 404);

      // produk & nilai varian tidak boleh berubah/terhapus selama SKU dibuat
      await lock(ref('produk', produk._id), produk.variants.map((v) => ref('variant', v._id)));
      const existing = new Set(await ProdukSku.find({ produk: produk._id }).distinct('comboKey'));
      const taken = new Set();
      const toCreate = [];

      if (!produk.variants.length) {
        if (!existing.has('')) {
          toCreate.push({ variantValues: [], comboKey: '', sku: await generateSkuCode(produk.name, [], taken) });
        }
      } else {
        const selections = req.body.selections || {};
        const lists = [];
        for (const variant of produk.variants) {
          const chosen = (selections[String(variant._id)] || [])
            .filter((v) => variant.values.includes(v));
          if (!chosen.length) throw new HttpError(`Please choose at least one value for ${variant.name}`, 400);
          lists.push(chosen.map((value) => ({ variant: variant._id, value })));
        }

        for (const combo of cartesian(lists)) {
          const comboKey = buildComboKey(combo);
          if (existing.has(comboKey)) continue;
          existing.add(comboKey);
          toCreate.push({
            variantValues: combo,
            comboKey,
            sku: await generateSkuCode(produk.name, combo.map((c) => c.value), taken),
          });
        }
      }

      if (toCreate.length) {
        const created = await ProdukSku.insertMany(toCreate.map((s) => ({
          ...s,
          produk: produk._id,
          createdBy: req.user._id,
        })));
        await audit.logCreate(req, 'produkSku', created);
      }
      return toCreate.length;
    });

    const message = createdCount
      ? `${createdCount} SKU successfully created`
      : 'No new SKU: all selected combinations already exist';
    return successResponse(res, { created: createdCount }, message, createdCount ? 201 : 200);
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * PUT /api/produk/:id/sku — simpan banyak SKU sekaligus (tabel yang bisa diedit)
 * body: { skus: [{ _id, sku, hargaJual, barcode, isActive }] }  (barcode kosong = dihapus; unik antar SKU)
 * Stok TIDAK bisa diubah di sini (field stok diabaikan): hanya lewat dokumen Stock Adjustment.
 */
exports.bulkUpdateSku = async (req, res) => {
  try {
    const items = Array.isArray(req.body.skus) ? req.body.skus : [];
    if (!items.length) {
      return errorResponse(res, 'No SKU to update', 400);
    }

    // validasi input dulu (di luar transaksi)
    const codes = new Set();
    const barcodes = new Set();
    for (const item of items) {
      const code = String(item.sku || '').trim().toUpperCase();
      if (!mongoose.isValidObjectId(item._id)) return errorResponse(res, 'Invalid SKU id', 400);
      if (!code) return errorResponse(res, 'SKU code is required', 400);
      if (codes.has(code)) return errorResponse(res, `SKU code ${code} is duplicated`, 400);
      codes.add(code);
      const priceError = checkAmount(item.hargaJual, `Selling price of ${code}`);
      if (priceError) return errorResponse(res, priceError, 400);
      if (item.barcode !== undefined && item.barcode !== null) {
        const bc = String(item.barcode).trim();
        if (bc.length > 64 || /\s/.test(bc)) return errorResponse(res, `Barcode of ${code} must be at most 64 characters without spaces`, 400);
        if (bc && barcodes.has(bc)) return errorResponse(res, `Barcode ${bc} is duplicated`, 400);
        if (bc) barcodes.add(bc);
      }
    }

    await runInTransaction(async () => {
      await lock(ref('produk', req.params.id));
      const ids = items.map((i) => i._id);
      const current = await ProdukSku.find({ _id: { $in: ids }, produk: req.params.id }).lean();
      if (current.length !== items.length) throw new HttpError('Some SKUs do not belong to this product', 400);
      const before = await audit.snap('produkSku', current);
      if (barcodes.size) {
        const taken = await ProdukSku.findOne({ barcode: { $in: [...barcodes] }, _id: { $nin: ids } }).select('sku barcode').lean();
        if (taken) throw new HttpError(`Barcode ${taken.barcode} is already used by ${taken.sku}`, 400);
      }

      await ProdukSku.bulkWrite(items.map((item) => ({
        updateOne: {
          filter: { _id: item._id, produk: req.params.id },
          update: {
            $set: {
              sku: String(item.sku).trim().toUpperCase(),
              hargaJual: round2(item.hargaJual),
              isActive: item.isActive !== false,
              updatedDate: new Date(),
              updatedBy: req.user._id,
              ...(item.barcode !== undefined && item.barcode !== null && String(item.barcode).trim()
                ? { barcode: String(item.barcode).trim() } : {}),
            },
            ...(item.barcode !== undefined && (item.barcode === null || !String(item.barcode).trim())
              ? { $unset: { barcode: '' } } : {}),
          },
        }
      })));

      // 1 log per SKU yang benar-benar berubah, dikelompokkan dalam 1 batch
      await audit.logUpdate(req, 'produkSku', before, await ProdukSku.find({ _id: { $in: ids } }).lean());
    });

    return successResponse(res, { updated: items.length }, `${items.length} SKU successfully updated`);
  } catch (error) {
    return handleError(res, error);
  }
};

const MAX_PACKAGES = 20;

/** Kemasan dipakai dokumen penjualan / price list (tidak boleh dihapus, hanya dinonaktifkan) */
const packageInUse = async (skuId, uomId) => {
  const line = { lines: { $elemMatch: { sku: skuId, uom: uomId } } };
  for (const name of ['SalesOrder', 'SalesInvoice', 'Quotation', 'DeliveryOrder']) {
    if (await mongoose.model(name).exists(line)) return true;
  }
  return !!(await mongoose.model('PriceList').exists({ items: { $elemMatch: { sku: skuId, uom: uomId } } }));
};

/**
 * PUT /api/produk/:id/sku/:skuId/packages  body: { packages: [{ uom, konversi, hargaJual, barcode, isActive }] }
 * Mengganti daftar kemasan jual SKU (izin produk:update). Satuan unik & bukan satuan dasar, isi > 1 dan jenis
 * satuan cocok (aturan konversi pembelian), harga kosong = isi x harga satuan dasar, barcode unik terhadap semua
 * barcode SKU & kemasan. Kemasan yang sudah dipakai dokumen / price list tidak bisa dihapus.
 */
exports.updatePackages = async (req, res) => {
  try {
    const input = Array.isArray(req.body.packages) ? req.body.packages : null;
    if (!input) return errorResponse(res, 'Invalid packages', 400);
    if (input.length > MAX_PACKAGES) return errorResponse(res, `At most ${MAX_PACKAGES} packages per SKU`, 400);
    if (!mongoose.isValidObjectId(req.params.skuId)) return errorResponse(res, 'SKU not found', 404);
    const seenUom = new Set();
    const barcodes = new Set();
    const packages = [];
    for (const [i, p] of input.entries()) {
      const n = `Package ${i + 1}`;
      if (!mongoose.isValidObjectId(p?.uom)) return errorResponse(res, `${n}: choose a unit`, 400);
      if (seenUom.has(String(p.uom))) return errorResponse(res, `${n}: the same unit appears more than once`, 400);
      seenUom.add(String(p.uom));
      const err = checkAmount(p.konversi, `${n} content`, { min: 0, exclusive: true });
      if (err) return errorResponse(res, err, 400);
      const konversi = round2(p.konversi);
      if (konversi <= 1) return errorResponse(res, `${n}: content must be more than 1 base unit`, 400);
      let hargaJual = null;
      if (p.hargaJual !== undefined && p.hargaJual !== null && p.hargaJual !== '') {
        const perr = checkAmount(p.hargaJual, `${n} price`);
        if (perr) return errorResponse(res, perr, 400);
        hargaJual = round2(p.hargaJual);
      }
      let barcode = null;
      if (p.barcode !== undefined && p.barcode !== null && String(p.barcode).trim()) {
        barcode = String(p.barcode).trim();
        if (barcode.length > 64 || /\s/.test(barcode)) return errorResponse(res, `${n}: barcode must be at most 64 characters without spaces`, 400);
        if (barcodes.has(barcode)) return errorResponse(res, `Barcode ${barcode} is duplicated`, 400);
        barcodes.add(barcode);
      }
      packages.push({ ...(mongoose.isValidObjectId(p._id) ? { _id: p._id } : {}), uom: String(p.uom), konversi, hargaJual, barcode, isActive: p.isActive !== false });
    }

    const sku = await runInTransaction(async () => {
      await lock(ref('produk', req.params.id));
      const sku = await ProdukSku.findOne({ _id: req.params.skuId, produk: req.params.id });
      if (!sku) throw new HttpError('SKU not found', 404);
      const produk = await Produk.findById(sku.produk).select('uom').lean();
      await lock(packages.map((p) => ref('uom', p.uom)));
      if (packages.some((p) => String(p.uom) === String(produk.uom))) throw new HttpError('The base unit is not a package; choose another unit', 400);
      const { assertConvertible } = require('../helpers/uomHelper');
      await assertConvertible(packages.map((p) => ({ purchaseId: p.uom, baseId: produk.uom, konversi: p.konversi, label: sku.sku })));
      if (barcodes.size) {
        const taken = await ProdukSku.findOne({
          $or: [{ barcode: { $in: [...barcodes] } }, { _id: { $ne: sku._id }, 'packages.barcode': { $in: [...barcodes] } }],
        }).select('sku').lean();
        if (taken) throw new HttpError(`Barcode is already used by ${taken.sku}`, 400);
      }
      const keep = new Set(packages.map((p) => String(p.uom)));
      for (const old of sku.packages) {
        if (!keep.has(String(old.uom)) && await packageInUse(sku._id, old.uom)) {
          throw new HttpError(`A package of ${sku.sku} is already used in sales documents or price lists. Deactivate it instead.`, 400);
        }
      }
      const before = await audit.snap('produkSku', [sku]);
      sku.packages = packages;
      sku.updatedDate = new Date();
      sku.updatedBy = req.user._id;
      await sku.save();
      await audit.logUpdate(req, 'produkSku', before, [sku]);
      return sku;
    });
    const out = await ProdukSku.findById(sku._id).select('sku packages').populate('packages.uom', 'code name').lean();
    return successResponse(res, out, `Packages of ${sku.sku} saved`);
  } catch (error) {
    return handleError(res, error);
  }
};

// DELETE /api/produk/:id/sku/:skuId — ikut menghapus harga vendor untuk SKU ini
exports.deleteSku = async (req, res) => {
  try {
    const sku = await runInTransaction(async () => {
      const sku = await ProdukSku.findOne({ _id: req.params.skuId, produk: req.params.id });
      if (!sku) throw new HttpError('SKU not found', 404);

      await lock(ref('produk', sku.produk)); // bentrok dengan tambah harga vendor / dokumen stok untuk SKU ini
      if ((await skusWithStockHistory([sku._id])).size) {
        throw new HttpError(`${sku.sku} already has stock history and cannot be deleted. Deactivate it instead.`, 400);
      }
      // snapshot sebelum dihapus: SKU + semua harga vendornya, 1 batch
      const prices = await audit.snap('vendorPrice', await VendorPrice.find({ sku: sku._id }).lean());
      const skuSnap = await audit.snap('produkSku', [sku]);

      await VendorPrice.deleteMany({ sku: sku._id });
      await require('../models/ReorderRule').deleteMany({ sku: sku._id });
      await require('../models/PriceList').updateMany({ 'items.sku': sku._id }, { $pull: { items: { sku: sku._id } } });
      await sku.deleteOne();

      const batchId = audit.newBatchId();
      await audit.logDelete(req, 'vendorPrice', prices, { batchId });
      await audit.logDelete(req, 'produkSku', skuSnap, { batchId });
      return sku;
    });

    return successResponse(res, sku, "SKU successfully deleted", 200);
  } catch (error) {
    return handleError(res, error);
  }
};
