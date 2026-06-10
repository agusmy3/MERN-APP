const Vendor = require('../models/Vendor');
const {
  successResponse,
  errorResponse
} = require("../helpers/responseHelper");

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
    try{
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
        
        return successResponse(
            res,
            vendor,
            "Vendor successfully added",
            201
        );
    }catch(error){
        return errorResponse(
            res,
            error.message,
            500
        );
    }
};

// PUT update vendor
exports.updateVendor = async (req, res) => {
    try{
        const vendor = await Vendor.findById(req.params.id);
        if (!vendor){
            return errorResponse(
                res,
                'Vendor not found',
                404
            );
        } 

        vendor.companyName = req.body.companyName || vendor.companyName;
        vendor.picName = req.body.picName || vendor.picName;
        vendor.picContact = req.body.picContact || vendor.picContact;
        vendor.companyAddress = req.body.companyAddress || vendor.companyAddress;
        vendor.updatedDate = new Date();
        vendor.updatedBy = req.user._id;
        await vendor.save();
        
        return successResponse(
            res,
            vendor,
            "Vendor successfully updated",
            200
        );
    }catch(error){
        return errorResponse(
            res,
            error.message,
            500
        );
    }
};

// DELETE vendor
exports.deleteVendor = async (req, res) => {
    try{
        const vendor = await Vendor.findById(req.params.id);
        if (!vendor){
            return errorResponse(
                res,
                'Vendor not found',
                404
            );
        } 

        await Vendor.deleteOne();

        return successResponse(
            res,
            vendor,
            "Vendor successfully deleted",
            200
        );
    }catch(error){
        return errorResponse(
            res,
            error.message,
            500
        );
    }
  
};
