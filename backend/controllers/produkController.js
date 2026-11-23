const mongoose = require('mongoose');
const Produk = require('../models/Produk');
const ProdukSku = require('../models/ProdukSku');
const VendorPrice = require('../models/VendorPrice');
const Uom = require('../models/Uom');
const Variant = require('../models/Variant');
const Kategori = require('../models/Kategori');
const {
  successResponse,
  errorResponse
} = require("../helpers/responseHelper");
const audit = require('../helpers/auditLogger');
const { runInTransaction, HttpError, lock, ref } = require('../helpers/transaction');
const { generateSkuCode } = require('../helpers/skuHelper');
const { skusWithStockHistory } = require('../helpers/stockHelper');

const SORTABLE_FIELDS = ['name', 'createdDate', 'updatedDate'];

const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status);
  if (error.name === 'ValidationError' || error.name === 'CastError') {
    return errorResponse(res, error.message, 400);
  }
  return errorResponse(res, error.message, 500);
};

const toIdList = (value) => [...new Set((Array.isArray(value) ? value : [])
  .map(String)
  .filter((id) => mongoose.isValidObjectId(id)))];

// Ringkasan SKU per produk: jumlah SKU, rentang harga jual, total stok
const withSkuSummary = async (produkList) => {
  const summary = await ProdukSku.aggregate([
    { $match: { produk: { $in: produkList.map((p) => p._id) } } },
    {
      $group: {
        _id: '$produk',
        skuCount: { $sum: 1 },
        minHarga: { $min: '$hargaJual' },
        maxHarga: { $max: '$hargaJual' },
        totalStok: { $sum: '$stok' },
      }
    },
  ]);
  const map = new Map(summary.map((s) => [String(s._id), s]));
  return produkList.map((p) => {
    const s = map.get(String(p._id));
    return {
      ...p,
      skuCount: s?.skuCount || 0,
      minHarga: s?.minHarga ?? null,
      maxHarga: s?.maxHarga ?? null,
      totalStok: s?.totalStok || 0,
    };
  });
};

// Validasi referensi dari body (kategori, uom, variants); return pesan error atau null
const validateRefs = async ({ kategori, uom, variants }) => {
  if (!mongoose.isValidObjectId(kategori) || !(await Kategori.exists({ _id: kategori }))) {
    return 'Please select a valid category';
  }
  if (!mongoose.isValidObjectId(uom) || !(await Uom.exists({ _id: uom }))) {
    return 'Please select a valid UoM';
  }
  if (variants.length && (await Variant.countDocuments({ _id: { $in: variants } })) !== variants.length) {
    return 'One or more variants are not valid';
  }
  return null;
};

// GET semua produk (tanpa paginasi)
exports.getAllProduk = async (req, res) => {
  try {
    const produk = await Produk.find()
      .populate('kategori', 'name')
      .populate('uom', 'code name')
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .lean();

    return successResponse(res, await withSkuSummary(produk));
  } catch (error) {
    return handleError(res, error);
  }
};

// GET produk dengan search, sort, dan paginasi
exports.getProduk = async (req, res) => {
  try {
    const search = req.query.search || '';
    const page = parseInt(req.query.page || 1);
    const pageSize = parseInt(req.query.pageSize || 5);
    const sortField = SORTABLE_FIELDS.includes(req.query.sortField)
      ? req.query.sortField
      : 'createdDate';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    let filter = {};

    if (search) {
      // juga cari berdasarkan kode SKU
      const skuMatches = await ProdukSku.find({ sku: { $regex: search, $options: 'i' } }).distinct('produk');
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { deskripsi: { $regex: search, $options: "i" } },
        { _id: { $in: skuMatches } },
      ];
    }

    const totalData = await Produk.countDocuments(filter);

    const produk = await Produk.find(filter)
      .populate('kategori', 'name')
      .populate('uom', 'code name')
      .populate('variants', 'code name')
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .collation({ locale: 'en', strength: 2 })
      .sort({ [sortField]: sortOrder })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();

    return successResponse(res, {
      dataProduk: await withSkuSummary(produk),
      totalData,
      currentPage: page,
      totalPages: Math.ceil(totalData / pageSize)
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// GET single produk (untuk halaman detail)
exports.getSingleProduk = async (req, res) => {
  try {
    const produk = await Produk.findById(req.params.id)
      .populate('kategori', 'name')
      .populate('uom', 'code name')
      .populate('variants', 'code name values')
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .lean();
    if (!produk) {
      return errorResponse(res, 'Product not found', 404);
    }

    const [withSummary] = await withSkuSummary([produk]);
    return successResponse(res, withSummary);
  } catch (error) {
    return handleError(res, error);
  }
};

// POST tambah produk. Produk tanpa varian langsung dibuatkan 1 SKU default.
exports.createProduk = async (req, res) => {
  try {
    const { name, deskripsi, kategori, uom } = req.body;
    const variants = toIdList(req.body.variants);

    const produk = await runInTransaction(async () => {
      // referensi tidak boleh terhapus bersamaan (bentrok dengan delete kategori/uom/variant)
      await lock(ref('kategori', kategori), ref('uom', uom), variants.map((v) => ref('variant', v)));
      const refError = await validateRefs({ kategori, uom, variants });
      if (refError) throw new HttpError(refError, 400);

      const produk = await Produk.create({
        name,
        deskripsi,
        kategori,
        uom,
        variants,
        createdBy: req.user._id
      });

      const batchId = audit.newBatchId();
      await audit.logCreate(req, 'produk', [produk], { batchId });

      if (!variants.length) {
        const sku = await ProdukSku.create({
          produk: produk._id,
          sku: await generateSkuCode(produk.name),
          comboKey: '',
          createdBy: req.user._id,
        });
        await audit.logCreate(req, 'produkSku', [sku], { batchId });
      }
      return produk;
    });

    return successResponse(res, produk, "Product successfully added", 201);
  } catch (error) {
    return handleError(res, error);
  }
};

// PUT update produk (info). Jenis varian hanya bisa diubah selama produk belum punya SKU.
exports.updateProduk = async (req, res) => {
  try {
    const produk = await runInTransaction(async () => {
      const produk = await Produk.findById(req.params.id);
      if (!produk) throw new HttpError('Product not found', 404);

      const kategori = req.body.kategori || produk.kategori;
      const uom = req.body.uom || produk.uom;
      const variants = req.body.variants !== undefined
        ? toIdList(req.body.variants)
        : produk.variants.map(String);

      const current = produk.variants.map(String).sort().join(',');
      const variantsChanged = current !== [...variants].sort().join(',');
      if (variantsChanged && (await ProdukSku.exists({ produk: produk._id }))) {
        throw new HttpError('Variant types cannot be changed while the product still has SKUs. Delete its SKUs first.', 400);
      }

      await lock(
        ref('produk', produk._id),
        ref('kategori', kategori), ref('uom', uom), variants.map((v) => ref('variant', v))
      );
      const refError = await validateRefs({ kategori, uom, variants });
      if (refError) throw new HttpError(refError, 400);

      const before = await audit.snap('produk', [produk]);
      const batchId = audit.newBatchId();

      produk.name = req.body.name || produk.name;
      produk.deskripsi = req.body.deskripsi ?? produk.deskripsi;
      produk.kategori = kategori;
      produk.uom = uom;
      produk.variants = variants;
      produk.updatedDate = new Date();
      produk.updatedBy = req.user._id;
      await produk.save();
      await audit.logUpdate(req, 'produk', before, [produk], { batchId });

      // produk tanpa varian selalu punya SKU default
      if (!variants.length && !(await ProdukSku.exists({ produk: produk._id }))) {
        const sku = await ProdukSku.create({
          produk: produk._id,
          sku: await generateSkuCode(produk.name),
          comboKey: '',
          createdBy: req.user._id,
        });
        await audit.logCreate(req, 'produkSku', [sku], { batchId });
      }
      return produk;
    });

    return successResponse(res, produk, "Product successfully updated", 200);
  } catch (error) {
    return handleError(res, error);
  }
};

// DELETE produk — ikut menghapus semua SKU & harga vendornya
exports.deleteProduk = async (req, res) => {
  try {
    // produk + semua SKU + semua harga vendor + log-nya: terhapus semua atau tidak sama sekali
    const produk = await runInTransaction(async () => {
      const produk = await Produk.findById(req.params.id);
      if (!produk) throw new HttpError('Product not found', 404);

      // bentrok dengan generate SKU / tambah harga vendor untuk produk ini
      await lock(ref('produk', produk._id));
      // SKU yang sudah punya histori stok tidak boleh hilang (kartu stok ikut hilang)
      const skuIds = await ProdukSku.find({ produk: produk._id }).distinct('_id');
      const withHistory = await skusWithStockHistory(skuIds);
      if (withHistory.size) {
        throw new HttpError(`Product has ${withHistory.size} SKU(s) with stock history and cannot be deleted. Deactivate its SKUs instead.`, 400);
      }
      const prices = await audit.snap('vendorPrice', await VendorPrice.find({ produk: produk._id }).lean());
      const skus = await audit.snap('produkSku', await ProdukSku.find({ produk: produk._id }).lean());
      const produkSnap = await audit.snap('produk', [produk]);

      await VendorPrice.deleteMany({ produk: produk._id });
      await ProdukSku.deleteMany({ produk: produk._id });
      await produk.deleteOne();

      const batchId = audit.newBatchId();
      await audit.logDelete(req, 'vendorPrice', prices, { batchId });
      await audit.logDelete(req, 'produkSku', skus, { batchId });
      await audit.logDelete(req, 'produk', produkSnap, { batchId });
      return produk;
    });

    return successResponse(res, produk, "Product successfully deleted", 200);
  } catch (error) {
    return handleError(res, error);
  }
};
