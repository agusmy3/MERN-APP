const Uom = require('../models/Uom');
const Produk = require('../models/Produk');
const VendorPrice = require('../models/VendorPrice');
const {
  successResponse,
  errorResponse
} = require("../helpers/responseHelper");
const audit = require('../helpers/auditLogger');
const { runInTransaction, HttpError, lock, ref } = require('../helpers/transaction');
const { UOM_TYPES } = require('../config/uom');
const { typeChangeConflicts } = require('../helpers/uomHelper');

// jenis satuan wajib dan harus dari daftar
const parseType = (type) => {
  if (!UOM_TYPES[type]) throw new HttpError(`Please select a UoM type (${Object.keys(UOM_TYPES).join(', ')})`, 400);
  return type;
};

const SORTABLE_FIELDS = ['code', 'name', 'createdDate', 'updatedDate'];

// Ubah error duplikat (unique index pada code) menjadi pesan 400 yang jelas
const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status);
  if (error.code === 11000) {
    return errorResponse(res, 'UoM code already exists', 400);
  }
  return errorResponse(res, error.message, 500);
};

// GET semua UoM (tanpa paginasi, untuk dropdown)
exports.getAllUom = async (req, res) => {
  try {
    const uom = await Uom.find()
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .sort({ code: 1 });

    return successResponse(res, uom);
  } catch (error) {
    return handleError(res, error);
  }
};

// GET UoM dengan search, sort, dan paginasi
exports.getUom = async (req, res) => {
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
        { deskripsi: { $regex: search, $options: "i" } }
      ];
    }

    const totalData = await Uom.countDocuments(filter);

    const dataUom = await Uom.find(filter)
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .collation({ locale: 'en', strength: 2 })
      .sort({ [sortField]: sortOrder })
      .skip((page - 1) * pageSize)
      .limit(pageSize);

    return successResponse(res, {
      dataUom,
      totalData,
      currentPage: page,
      totalPages: Math.ceil(totalData / pageSize)
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// GET single UoM
exports.getSingleUom = async (req, res) => {
  try {
    const uom = await Uom.findById(req.params.id);
    if (!uom) {
      return errorResponse(res, 'UoM not found', 404);
    }

    return successResponse(res, uom);
  } catch (error) {
    return handleError(res, error);
  }
};

// POST tambah UoM
exports.createUom = async (req, res) => {
  try {
    const uom = await runInTransaction(async () => {
      const uom = await Uom.create({
        code: req.body.code,
        name: req.body.name,
        type: parseType(req.body.type),
        deskripsi: req.body.deskripsi,
        createdBy: req.user._id
      });
      await audit.logCreate(req, 'uom', [uom]);
      return uom;
    });

    return successResponse(res, uom, "UoM successfully added", 201);
  } catch (error) {
    return handleError(res, error);
  }
};

// PUT update UoM
exports.updateUom = async (req, res) => {
  try {
    const uom = await runInTransaction(async () => {
      const uom = await Uom.findById(req.params.id);
      if (!uom) throw new HttpError('UoM not found', 404);

      // ganti jenis: tolak jika ada harga vendor yang konversinya jadi tidak sah
      if (req.body.type !== undefined && req.body.type !== uom.type) {
        const type = parseType(req.body.type);
        await lock(ref('uom', uom._id)); // bentrok dengan harga vendor / produk yang sedang memakainya
        const conflicts = await typeChangeConflicts(uom._id, type);
        if (conflicts.length) {
          throw new HttpError(
            `Cannot change the type to ${UOM_TYPES[type]}: ${conflicts.length} vendor price(s) would become invalid, e.g. `
              + `${conflicts.slice(0, 3).join(', ')}. Fix those vendor prices first`,
            400
          );
        }
      }

      const before = await audit.snap('uom', [uom]);
      if (req.body.type !== undefined) uom.type = req.body.type;
      uom.code = req.body.code || uom.code;
      uom.name = req.body.name || uom.name;
      uom.deskripsi = req.body.deskripsi ?? uom.deskripsi;
      uom.updatedDate = new Date();
      uom.updatedBy = req.user._id;
      await uom.save();
      await audit.logUpdate(req, 'uom', before, [uom]);
      return uom;
    });

    return successResponse(res, uom, "UoM successfully updated", 200);
  } catch (error) {
    return handleError(res, error);
  }
};

// DELETE UoM
exports.deleteUom = async (req, res) => {
  try {
    const uom = await runInTransaction(async () => {
      const uom = await Uom.findById(req.params.id);
      if (!uom) throw new HttpError('UoM not found', 404);

      await lock(ref('uom', uom._id)); // bentrok dengan produk / harga vendor yang memakainya
      const produkCount = await Produk.countDocuments({ uom: uom._id });
      const priceCount = await VendorPrice.countDocuments({ uomBeli: uom._id });
      const poCount = await require('../models/PurchaseOrder').countDocuments({ 'lines.uomBeli': uom._id });
      if (produkCount || priceCount || poCount) {
        throw new HttpError(`UoM is still used by ${produkCount} product(s), ${priceCount} vendor price(s) and ${poCount} purchase order(s)`, 400);
      }

      const before = await audit.snap('uom', [uom]);
      await uom.deleteOne();
      await audit.logDelete(req, 'uom', before);
      return uom;
    });

    return successResponse(res, uom, "UoM successfully deleted", 200);
  } catch (error) {
    return handleError(res, error);
  }
};
