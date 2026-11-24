const express = require('express');
const protect = require('../middlewares/authMiddleware');
const authorize = require('../middlewares/authorize');
const adj = require('../controllers/stockAdjustmentController');
const mov = require('../controllers/stockMovementController');
const val = require('../controllers/stockValuationController');
const rev = require('../controllers/costRevaluationController');
const ro = require('../controllers/reorderController');

/**
 * Stock Adjustment (/api/stock-adjustment)
 *   create/update/delete = mengelola DRAFT (stok belum berubah)
 *   post                 = posting & pembatalan (mengubah stok) -> izin terpisah
 */
const adjustment = express.Router();
adjustment.get('/skus', protect, authorize('stockAdjustment', 'view'), adj.searchSkus);
adjustment.post('/skus/balance', protect, authorize('stockAdjustment', 'view'), adj.skuBalances);
adjustment.get('/', protect, authorize('stockAdjustment', 'view'), adj.getStockAdjustments);
adjustment.get('/:id', protect, authorize('stockAdjustment', 'view'), adj.getStockAdjustment);
adjustment.post('/', protect, authorize('stockAdjustment', 'create'), adj.createStockAdjustment);
adjustment.put('/:id', protect, authorize('stockAdjustment', 'update'), adj.updateStockAdjustment);
adjustment.delete('/:id', protect, authorize('stockAdjustment', 'delete'), adj.deleteStockAdjustment);
adjustment.post('/:id/post', protect, authorize('stockAdjustment', 'post'), adj.postStockAdjustment);
adjustment.post('/:id/cancel', protect, authorize('stockAdjustment', 'post'), adj.cancelStockAdjustment);

/** Stock Movement (/api/stock-movement): kartu stok & saldo per gudang, baca saja */
const movement = express.Router();
movement.get('/balance', protect, authorize('stockMovement', 'view'), mov.getBalances);
movement.get('/', protect, authorize('stockMovement', 'view'), mov.getMovements);

/**
 * Stock Valuation (/api/stock-valuation): stok x HPP. HPP & nilai persediaan = data biaya, jadi
 * memakai izin yang sama dengan harga beli (vendorPrice:view), bukan resource terpisah.
 */
const valuation = express.Router();
valuation.get('/', protect, authorize('vendorPrice', 'view'), val.getValuation);

/** Cost Revaluation (/api/cost-revaluation): isi / koreksi HPP tanpa mengubah stok */
const revaluation = express.Router();
revaluation.get('/skus', protect, authorize('costRevaluation', 'view'), rev.searchSkus);
revaluation.get('/', protect, authorize('costRevaluation', 'view'), rev.getRevaluations);
revaluation.get('/:id', protect, authorize('costRevaluation', 'view'), rev.getRevaluation);
revaluation.post('/', protect, authorize('costRevaluation', 'create'), rev.createRevaluation);
revaluation.put('/:id', protect, authorize('costRevaluation', 'update'), rev.updateRevaluation);
revaluation.delete('/:id', protect, authorize('costRevaluation', 'delete'), rev.deleteRevaluation);
revaluation.post('/:id/post', protect, authorize('costRevaluation', 'post'), rev.postRevaluation);
revaluation.post('/:id/cancel', protect, authorize('costRevaluation', 'post'), rev.cancelRevaluation);

/**
 * Reorder (/api/reorder): alert stok minimum per SKU + gudang.
 * create-po juga butuh purchaseOrder:create (dicek di controller).
 */
const reorder = express.Router();
reorder.get('/summary', protect, authorize('reorder', 'view'), ro.getSummary);
reorder.get('/rules', protect, authorize('reorder', 'view'), ro.getRules);
reorder.put('/rules', protect, authorize('reorder', 'update'), ro.saveRules);
reorder.post('/create-po', protect, authorize('reorder', 'view'), ro.createPurchaseOrders);
reorder.get('/', protect, authorize('reorder', 'view'), ro.getAlerts);

module.exports = { adjustment, movement, valuation, revaluation, reorder };
