const Vendor = require('../models/Vendor');
const VendorPrice = require('../models/VendorPrice');
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

// GET semua vendor
exports.getAllVendor = async (req, res) => {
    try{
        const vendor = await Vendor.find().populate('createdBy', 'name');

        return successResponse(
            res,
            vendor
        );
    }catch(error){
        return errorResponse(
            res,
            error.message,
            500
        );
    }
};

exports.getVendor = async (req, res) => {
    try {
        const search = req.query.search || '';
        const page = parseInt(req.query.page || 1);
        const pageSize = parseInt(req.query.pageSize || 5);
        const sortField = req.query.sortField || 'createdDate';
        const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
        let filter = {};

        if (search) {
            filter.$or = [
            {
                companyName: {
                    $regex: search,
                    $options: "i"
                }
            },
            {
                picName: {
                    $regex: search,
                    $options: "i"
                }
            }
            ];
        }

        const totalData = await Vendor.countDocuments(filter);

        const dataVendor = await Vendor.find(filter)
            .populate('createdBy', 'name')
            .populate('updatedBy', 'name')
            .sort({
                [sortField]: sortOrder
            })
            .skip((page - 1) * pageSize)
            .limit(pageSize);

        const pagination = {
            dataVendor,
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

// GET single vendor
exports.getSingleVendor = async (req, res) => {
    try{
        const vendor = await Vendor.findById(req.params.id).populate('createdBy', 'name');
        if (!vendor){
            return errorResponse(
                res,
                'Vendor not found',
                404
            );
        } 

        return successResponse(
            res,
            vendor
        );
    }catch(error){
        return errorResponse(
            res,
            error.message,
            500
        );
    }
};

// POST tambah vendor
exports.createVendor = async (req, res) => {
  try {
    const vendor = await runInTransaction(async () => {
      const vendor = await Vendor.create({
        companyName: req.body.companyName,
        picName: req.body.picName,
        picContact: req.body.picContact,
        companyAddress: req.body.companyAddress,
        createdDate: new Date(),
        createdBy: req.user._id,
        updatedDate: null,
        updatedBy: null
      });
      await audit.logCreate(req, 'vendor', [vendor]);
      return vendor;
    });

    return successResponse(res, vendor, "Vendor successfully added", 201);
  } catch (error) {
    return handleError(res, error);
  }
};

// PUT update vendor
exports.updateVendor = async (req, res) => {
  try {
    const vendor = await runInTransaction(async () => {
      const vendor = await Vendor.findById(req.params.id);
      if (!vendor) throw new HttpError('Vendor not found', 404);

      const before = await audit.snap('vendor', [vendor]);
      vendor.companyName = req.body.companyName || vendor.companyName;
      vendor.picName = req.body.picName || vendor.picName;
      vendor.picContact = req.body.picContact || vendor.picContact;
      vendor.companyAddress = req.body.companyAddress || vendor.companyAddress;
      vendor.updatedDate = new Date();
      vendor.updatedBy = req.user._id;
      await vendor.save();
      await audit.logUpdate(req, 'vendor', before, [vendor]);
      return vendor;
    });

    return successResponse(res, vendor, "Vendor successfully updated", 200);
  } catch (error) {
    return handleError(res, error);
  }
};

// DELETE vendor
exports.deleteVendor = async (req, res) => {
  try {
    const vendor = await runInTransaction(async () => {
      const vendor = await Vendor.findById(req.params.id);
      if (!vendor) throw new HttpError('Vendor not found', 404);

      await lock(ref('vendor', vendor._id)); // bentrok dengan penambahan harga dari vendor ini
      // vendor yang masih punya daftar harga produk tidak boleh dihapus
      const priceCount = await VendorPrice.countDocuments({ vendor: vendor._id });
      if (priceCount > 0) {
        throw new HttpError(
          `Vendor still has ${priceCount} product price(s). Delete them first from the product's Vendor Prices tab.`,
          400
        );
      }

      const before = await audit.snap('vendor', [vendor]);
      await vendor.deleteOne();
      await audit.logDelete(req, 'vendor', before);
      return vendor;
    });

    return successResponse(res, vendor, "Vendor successfully deleted", 200);
  } catch (error) {
    return handleError(res, error);
  }
};
