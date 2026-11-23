const mongoose = require('mongoose');
const StockMovement = require('../models/StockMovement');
const StockBalance = require('../models/StockBalance');
const ProdukSku = require('../models/ProdukSku');
const {
  successResponse,
  errorResponse
} = require('../helpers/responseHelper');
const { MOVEMENT_TYPES } = require('../config/stock');

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * GET /api/stock-movement — kartu stok / laporan pergerakan (baca saja).
 * Query: produk, sku, gudang, type, from, to (YYYY-MM-DD), search (kode SKU / no. dokumen),
 *        page, pageSize, sortOrder (default terbaru dulu)
 * Setiap baris membawa balanceAfter (saldo SKU di gudang tsb setelah pergerakan).
 */
exports.getMovements = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || 1) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || 20) || 20, 1), 200);
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const filter = {};

    for (const key of ['produk', 'sku', 'gudang']) {
      if (!req.query[key]) continue;
      if (!mongoose.isValidObjectId(req.query[key])) return errorResponse(res, `Invalid ${key}`, 400);
      filter[key] = req.query[key];
    }
    if (MOVEMENT_TYPES[req.query.type]) filter.type = req.query.type;
    if (req.query.from || req.query.to) {
      filter.date = {};
      if (req.query.from) filter.date.$gte = new Date(`${req.query.from}T00:00:00`);
      if (req.query.to) filter.date.$lte = new Date(`${req.query.to}T23:59:59.999`);
      if (Object.values(filter.date).some((d) => Number.isNaN(d.getTime()))) return errorResponse(res, 'Invalid date', 400);
    }
    if (req.query.search) {
      const rx = { $regex: escapeRegex(req.query.search), $options: 'i' };
      const skuIds = await ProdukSku.find({ sku: rx }).distinct('_id');
      filter.$or = [{ refNo: rx }, { sku: { $in: skuIds } }];
    }

    const [totalData, movements] = await Promise.all([
      StockMovement.countDocuments(filter),
      StockMovement.find(filter)
        .populate('sku', 'sku variantValues')
        .populate({ path: 'produk', select: 'name uom', populate: { path: 'uom', select: 'code' } })
        .populate('gudang', 'code name')
        .populate('createdBy', 'name')
        .sort({ date: sortOrder, _id: sortOrder })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);

    return successResponse(res, {
      dataMovement: movements,
      totalData,
      currentPage: page,
      totalPages: Math.ceil(totalData / pageSize),
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * GET /api/stock-movement/balance?produk=<id> — saldo per SKU per gudang untuk 1 produk.
 * -> [{ sku, gudang: { _id, code, name, isActive }, qty }]
 */
exports.getBalances = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.query.produk)) return errorResponse(res, 'Invalid product', 400);
    const balances = await StockBalance.find({ produk: req.query.produk })
      .select('sku gudang qty updatedDate')
      .populate('gudang', 'code name isActive')
      .lean();
    return successResponse(res, balances);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};
