const Kategori = require('../models/Kategori');
const {
  successResponse,
  errorResponse
} = require("../helpers/responseHelper");

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
    const kategori = await Kategori.create({
      name: req.body.name,
      deskripsi: req.body.deskripsi,
      createdBy: req.user._id,
    });

    return successResponse(
      res,
      kategori,
      "Category successfully added",
      201
    );
  } catch (error) {
    return errorResponse(
      res,
      error.message,
      500
    );
  }
};

// PUT update kategori
exports.updateKategori = async (req, res) => {
  try {
    const kategori = await Kategori.findById(req.params.id);
    if (!kategori) {
      return errorResponse(
        res,
        'Category not found',
        404
      );
    }

    kategori.name = req.body.name || kategori.name;
    kategori.deskripsi = req.body.deskripsi || kategori.deskripsi;
    kategori.updatedDate = new Date()
    kategori.updatedBy = req.user._id
    await kategori.save();
    
    return successResponse(
      res,
      kategori,
      "Category successfully updated",
      200
    );
  } catch (error) {
    return errorResponse(
      res,
      error.message,
      500
    );
  }
};

// DELETE kategori
exports.deleteKategori = async (req, res) => {
  try {
    const kategori = await Kategori.findById(req.params.id);
    if (!kategori) {
      return errorResponse(
        res,
        'Category not found',
        404
      );
    }

    await kategori.deleteOne();

    return successResponse(
      res,
      kategori,
      "Category successfully deleted",
      200
    );
  } catch (error) {
    return errorResponse(
      res,
      error.message,
      500
    );
  }
};
