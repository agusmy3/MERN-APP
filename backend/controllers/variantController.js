const Variant = require('../models/Variant');
const Produk = require('../models/Produk');
const ProdukSku = require('../models/ProdukSku');
const {
  successResponse,
  errorResponse
} = require("../helpers/responseHelper");
const audit = require('../helpers/auditLogger');
const { runInTransaction, HttpError, lock, ref } = require('../helpers/transaction');

const SORTABLE_FIELDS = ['code', 'name', 'createdDate', 'updatedDate'];

// Ubah error duplikat (unique index pada code) & validasi schema menjadi 400
const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status);
  if (error.code === 11000) {
    return errorResponse(res, 'Variant code already exists', 400);
  }
  if (error.name === 'ValidationError') {
    return errorResponse(res, Object.values(error.errors).map((e) => e.message).join(', '), 400);
  }
  return errorResponse(res, error.message, 500);
};

// Rapikan daftar nilai: trim, buang yang kosong, buang duplikat (case-insensitive)
const normalizeValues = (values) => {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  return values
    .map((v) => String(v).trim())
    .filter((v) => {
      const key = v.toLowerCase();
      if (!v || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

// GET semua variant (tanpa paginasi, untuk dropdown)
exports.getAllVariant = async (req, res) => {
  try {
    const variant = await Variant.find()
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .sort({ code: 1 });

    return successResponse(res, variant);
  } catch (error) {
    return handleError(res, error);
  }
};

// GET variant dengan search, sort, dan paginasi
exports.getVariant = async (req, res) => {
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
      filter.$or = [
        { code: { $regex: search, $options: "i" } },
        { name: { $regex: search, $options: "i" } },
        { values: { $regex: search, $options: "i" } },
        { deskripsi: { $regex: search, $options: "i" } }
      ];
    }

    const totalData = await Variant.countDocuments(filter);

    const dataVariant = await Variant.find(filter)
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .collation({ locale: 'en', strength: 2 })
      .sort({ [sortField]: sortOrder })
      .skip((page - 1) * pageSize)
      .limit(pageSize);

    return successResponse(res, {
      dataVariant,
      totalData,
      currentPage: page,
      totalPages: Math.ceil(totalData / pageSize)
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// GET single variant
exports.getSingleVariant = async (req, res) => {
  try {
    const variant = await Variant.findById(req.params.id);
    if (!variant) {
      return errorResponse(res, 'Variant not found', 404);
    }

    return successResponse(res, variant);
  } catch (error) {
    return handleError(res, error);
  }
};

// POST tambah variant
exports.createVariant = async (req, res) => {
  try {
    const variant = await runInTransaction(async () => {
      const variant = await Variant.create({
        code: req.body.code,
        name: req.body.name,
        values: normalizeValues(req.body.values),
        deskripsi: req.body.deskripsi,
        createdBy: req.user._id
      });
      await audit.logCreate(req, 'variant', [variant]);
      return variant;
    });

    return successResponse(res, variant, "Variant successfully added", 201);
  } catch (error) {
    return handleError(res, error);
  }
};

// PUT update variant
exports.updateVariant = async (req, res) => {
  try {
    const variant = await runInTransaction(async () => {
      const variant = await Variant.findById(req.params.id);
      if (!variant) throw new HttpError('Variant not found', 404);

      await lock(ref('variant', variant._id)); // bentrok dengan generate SKU yang memakai nilainya
      const before = await audit.snap('variant', [variant]);
      variant.code = req.body.code || variant.code;
      variant.name = req.body.name || variant.name;
      if (req.body.values !== undefined) {
        const nextValues = normalizeValues(req.body.values);
        // nilai yang dihapus tidak boleh masih dipakai SKU (mis. menghapus "Merah" saat ada SKU merah).
        // Dicek di dalam transaksi supaya tidak ada SKU baru yang lolos di antara cek & simpan.
        const removed = variant.values.filter((v) => !nextValues.includes(v));
        if (removed.length) {
          const usedSkus = await ProdukSku.find({
            variantValues: { $elemMatch: { variant: variant._id, value: { $in: removed } } },
          }).select('variantValues').lean();
          const usedValues = new Set(usedSkus.flatMap((s) => s.variantValues
            .filter((vv) => String(vv.variant) === String(variant._id))
            .map((vv) => vv.value)));
          const blocked = removed.filter((v) => usedValues.has(v));
          if (blocked.length) {
            throw new HttpError(`Value(s) ${blocked.join(', ')} still used by product SKU(s) and cannot be removed`, 400);
          }
        }
        variant.values = nextValues;
      }
      variant.deskripsi = req.body.deskripsi ?? variant.deskripsi;
      variant.updatedDate = new Date();
      variant.updatedBy = req.user._id;
      await variant.save();
      await audit.logUpdate(req, 'variant', before, [variant]);
      return variant;
    });

    return successResponse(res, variant, "Variant successfully updated", 200);
  } catch (error) {
    return handleError(res, error);
  }
};

// DELETE variant
exports.deleteVariant = async (req, res) => {
  try {
    const variant = await runInTransaction(async () => {
      const variant = await Variant.findById(req.params.id);
      if (!variant) throw new HttpError('Variant not found', 404);

      await lock(ref('variant', variant._id));
      const produkCount = await Produk.countDocuments({ variants: variant._id });
      if (produkCount > 0) throw new HttpError(`Variant is still used by ${produkCount} product(s)`, 400);

      const before = await audit.snap('variant', [variant]);
      await variant.deleteOne();
      await audit.logDelete(req, 'variant', before);
      return variant;
    });

    return successResponse(res, variant, "Variant successfully deleted", 200);
  } catch (error) {
    return handleError(res, error);
  }
};
