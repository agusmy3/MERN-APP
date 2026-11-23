const Kategori = require('../models/Kategori');
const Produk = require('../models/Produk');
const {
  successResponse,
  errorResponse
} = require("../helpers/responseHelper");
const audit = require('../helpers/auditLogger');
const { runInTransaction, HttpError, lock, ref } = require('../helpers/transaction');

const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status);
  if (error.name === 'ValidationError' || error.name === 'CastError') {
    return errorResponse(res, error.message, 400);
  }
  return errorResponse(res, error.message, 500);
};

// GET semua kategori
exports.getAllKategori = async (req, res) => {
  try {
    const kategori = await Kategori.find().populate('createdBy', 'name').populate('updatedBy', 'name');

    return successResponse(
      res,
      kategori
    );
  } catch (error) {
    return errorResponse(
      res,
      error.message,
      500
    );
  }
};

exports.getKategori = async (req, res) => {
  try {
    console.log(req.query);
    const search = req.query.search || '';
    const page = parseInt(req.query.page || 1);
    const pageSize = parseInt(req.query.pageSize || 5);
    const sortField = req.query.sortField || 'createdDate';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    let filter = {};

    if (search) {
      filter.$or = [
        {
          name: {
            $regex: search,
            $options: "i"
          }
        },
        {
          deskripsi: {
            $regex: search,
            $options: "i"
          }
        }
      ];
    }

    const totalData = await Kategori.countDocuments(filter);

    const dataKategori = await Kategori.find(filter)
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .collation({
        locale: 'en',
        strength: 2
      })
      .sort({
        [sortField]: sortOrder
      })
      .skip((page - 1) * pageSize)
      .limit(pageSize);

    const pagination = {
      dataKategori,
      totalData,
      currentPage: page,
      totalPages: Math.ceil(totalData / pageSize)
    };

    return successResponse(
      res,
      pagination
    );

  } catch (error) {
    return errorResponse(
      res,
      error.message,
      500
    );
  }
};

// GET single kategori
exports.getSingleKategori = async (req, res) => {
  try {
    const kategori = await Kategori.findById(req.params.id);
    if (!kategori) {
      return errorResponse(
        res,
        'Category not found',
        404
      );
    }

    return successResponse(
      res,
      kategori
    );
  } catch (error) {
    return errorResponse(
      res,
      error.message,
      500
    );
  }

  
};

// POST tambah kategori
exports.createKategori = async (req, res) => {
  try {
    const kategori = await runInTransaction(async () => {
      const kategori = await Kategori.create({
        name: req.body.name,
        deskripsi: req.body.deskripsi,
        createdBy: req.user._id,
      });
      await audit.logCreate(req, 'kategori', [kategori]);
      return kategori;
    });

    return successResponse(res, kategori, "Category successfully added", 201);
  } catch (error) {
    return handleError(res, error);
  }
};

// PUT update kategori
exports.updateKategori = async (req, res) => {
  try {
    const kategori = await runInTransaction(async () => {
      const kategori = await Kategori.findById(req.params.id);
      if (!kategori) throw new HttpError('Category not found', 404);

      const before = await audit.snap('kategori', [kategori]);
      kategori.name = req.body.name || kategori.name;
      kategori.deskripsi = req.body.deskripsi ?? kategori.deskripsi;
      kategori.updatedDate = new Date();
      kategori.updatedBy = req.user._id;
      await kategori.save();
      await audit.logUpdate(req, 'kategori', before, [kategori]);
      return kategori;
    });

    return successResponse(res, kategori, "Category successfully updated", 200);
  } catch (error) {
    return handleError(res, error);
  }
};

// DELETE kategori
exports.deleteKategori = async (req, res) => {
  try {
    const kategori = await runInTransaction(async () => {
      const kategori = await Kategori.findById(req.params.id);
      if (!kategori) throw new HttpError('Category not found', 404);

      await lock(ref('kategori', kategori._id)); // bentrok dengan create/update produk yang memakainya
      const produkCount = await Produk.countDocuments({ kategori: kategori._id });
      if (produkCount > 0) throw new HttpError(`Category is still used by ${produkCount} product(s)`, 400);

      const before = await audit.snap('kategori', [kategori]);
      await kategori.deleteOne();
      await audit.logDelete(req, 'kategori', before);
      return kategori;
    });

    return successResponse(res, kategori, "Category successfully deleted", 200);
  } catch (error) {
    return handleError(res, error);
  }
};
