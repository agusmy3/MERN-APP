const Gudang = require('../models/Gudang');
const StockBalance = require('../models/StockBalance');
const StockMovement = require('../models/StockMovement');
const StockAdjustment = require('../models/StockAdjustment');
const {
  successResponse,
  errorResponse
} = require("../helpers/responseHelper");
const audit = require('../helpers/auditLogger');
const { runInTransaction, HttpError, lock, ref } = require('../helpers/transaction');

const SORTABLE_FIELDS = ['code', 'name', 'provinsi', 'kota', 'createdDate', 'updatedDate'];

const { parseLocation } = require('../helpers/locationHelper');

const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status);
  if (error.code === 11000) {
    return errorResponse(res, 'Warehouse code already exists', 400);
  }
  if (error.name === 'ValidationError' || error.name === 'CastError') {
    return errorResponse(res, error.message, 400);
  }
  return errorResponse(res, error.message, 500);
};

// GET semua gudang (tanpa paginasi)
exports.getAllGudang = async (req, res) => {
  try {
    const gudang = await Gudang.find()
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .sort({ code: 1 });
    return successResponse(res, gudang);
  } catch (error) {
    return handleError(res, error);
  }
};

// GET gudang dengan search, sort, dan paginasi
exports.getGudang = async (req, res) => {
  try {
    const search = req.query.search || '';
    const page = parseInt(req.query.page || 1);
    const pageSize = parseInt(req.query.pageSize || 5);
    const sortField = SORTABLE_FIELDS.includes(req.query.sortField)
      ? req.query.sortField
      : 'createdDate';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const filter = {};

    if (search) {
      filter.$or = [
        { code: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } },
        { alamat: { $regex: search, $options: 'i' } },
        { provinsi: { $regex: search, $options: 'i' } },
        { kota: { $regex: search, $options: 'i' } },
        { kecamatan: { $regex: search, $options: 'i' } },
        { kodePos: { $regex: search, $options: 'i' } },
        { deskripsi: { $regex: search, $options: 'i' } },
      ];
    }

    const totalData = await Gudang.countDocuments(filter);
    const dataGudang = await Gudang.find(filter)
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .collation({ locale: 'en', strength: 2 })
      .sort({ [sortField]: sortOrder })
      .skip((page - 1) * pageSize)
      .limit(pageSize);

    return successResponse(res, {
      dataGudang,
      totalData,
      currentPage: page,
      totalPages: Math.ceil(totalData / pageSize)
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// GET single gudang
exports.getSingleGudang = async (req, res) => {
  try {
    const gudang = await Gudang.findById(req.params.id);
    if (!gudang) return errorResponse(res, 'Warehouse not found', 404);
    return successResponse(res, gudang);
  } catch (error) {
    return handleError(res, error);
  }
};

// POST tambah gudang
exports.createGudang = async (req, res) => {
  try {
    const location = parseLocation(req.body);
    const gudang = await runInTransaction(async () => {
      const gudang = await Gudang.create({
        code: req.body.code,
        name: req.body.name,
        ...location,
        isActive: req.body.isActive !== false,
        createdBy: req.user._id
      });
      await audit.logCreate(req, 'gudang', [gudang]);
      return gudang;
    });

    return successResponse(res, gudang, 'Warehouse successfully added', 201);
  } catch (error) {
    return handleError(res, error);
  }
};

// PUT update gudang (termasuk menonaktifkan)
exports.updateGudang = async (req, res) => {
  try {
    const gudang = await runInTransaction(async () => {
      const gudang = await Gudang.findById(req.params.id);
      if (!gudang) throw new HttpError('Warehouse not found', 404);

      const before = await audit.snap('gudang', [gudang]);
      gudang.code = req.body.code || gudang.code;
      gudang.name = req.body.name || gudang.name;
      Object.assign(gudang, parseLocation(req.body));
      if (req.body.isActive !== undefined) gudang.isActive = req.body.isActive !== false;
      gudang.updatedDate = new Date();
      gudang.updatedBy = req.user._id;
      await gudang.save();
      await audit.logUpdate(req, 'gudang', before, [gudang]);
      return gudang;
    });

    return successResponse(res, gudang, 'Warehouse successfully updated', 200);
  } catch (error) {
    return handleError(res, error);
  }
};

// DELETE gudang: hanya jika belum pernah punya stok / dokumen stok
exports.deleteGudang = async (req, res) => {
  try {
    const gudang = await runInTransaction(async () => {
      const gudang = await Gudang.findById(req.params.id);
      if (!gudang) throw new HttpError('Warehouse not found', 404);

      await lock(ref('gudang', gudang._id)); // bentrok dengan dokumen stok baru untuk gudang ini
      const [balance, movement, docs] = await Promise.all([
        StockBalance.exists({ gudang: gudang._id }),
        StockMovement.exists({ gudang: gudang._id }),
        StockAdjustment.countDocuments({ gudang: gudang._id }),
      ]);
      const poCount = await require('../models/PurchaseOrder').countDocuments({ gudang: gudang._id });
      const trfCount = await require('../models/StockTransfer').countDocuments({ $or: [{ fromGudang: gudang._id }, { toGudang: gudang._id }] });
      const invCount = await require('../models/SalesInvoice').countDocuments({ gudang: gudang._id })
        + await require('../models/SalesOrder').countDocuments({ gudang: gudang._id })
        + await require('../models/Quotation').countDocuments({ gudang: gudang._id });
      const outletCount = await require('../models/Outlet').countDocuments({ gudang: gudang._id });
      if (outletCount) throw new HttpError(`Warehouse supplies ${outletCount} POS outlet(s). Move or delete them first.`, 400);
      if (balance || movement || docs || poCount || trfCount || invCount) {
        throw new HttpError('Warehouse already has stock history or documents. Deactivate it instead.', 400);
      }

      // lepaskan dari penugasan user (diaudit sebagai perubahan user, sebelum gudangnya terhapus)
      const batchId = audit.newBatchId();
      const User = require('../models/User');
      const users = await User.find({ gudangs: gudang._id });
      if (users.length) {
        const usersBefore = await audit.snap('user', users);
        for (const u of users) {
          u.gudangs.pull(gudang._id);
          await u.save();
        }
        await audit.logUpdate(req, 'user', usersBefore, users, { batchId });
      }

      const before = await audit.snap('gudang', [gudang]);
      await require('../models/ReorderRule').deleteMany({ gudang: gudang._id });
      await gudang.deleteOne();
      await audit.logDelete(req, 'gudang', before, { batchId });
      return gudang;
    });

    return successResponse(res, gudang, 'Warehouse successfully deleted', 200);
  } catch (error) {
    return handleError(res, error);
  }
};
