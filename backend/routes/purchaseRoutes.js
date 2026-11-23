const express = require('express');
const protect = require('../middlewares/authMiddleware');
const authorize = require('../middlewares/authorize');
const po = require('../controllers/purchaseOrderController');
const gr = require('../controllers/goodsReceiptController');

/**
 * Purchase Order (/api/purchase-order)
 *   create = buat draft / terbitkan; update = ubah draft, terbitkan draft, close & cancel; delete = hapus draft
 */
const purchaseOrder = express.Router();
purchaseOrder.get('/items', protect, authorize('purchaseOrder', 'view'), po.searchItems);
purchaseOrder.get('/', protect, authorize('purchaseOrder', 'view'), po.getPurchaseOrders);
purchaseOrder.get('/:id', protect, authorize('purchaseOrder', 'view'), po.getPurchaseOrder);
purchaseOrder.post('/', protect, authorize('purchaseOrder', 'create'), po.createPurchaseOrder);
purchaseOrder.put('/:id', protect, authorize('purchaseOrder', 'update'), po.updatePurchaseOrder);
purchaseOrder.delete('/:id', protect, authorize('purchaseOrder', 'delete'), po.deletePurchaseOrder);
purchaseOrder.post('/:id/issue', protect, authorize('purchaseOrder', 'update'), po.issuePurchaseOrder);
purchaseOrder.post('/:id/cancel', protect, authorize('purchaseOrder', 'update'), po.cancelPurchaseOrder);
purchaseOrder.post('/:id/close', protect, authorize('purchaseOrder', 'update'), po.closePurchaseOrder);

/**
 * Goods Receipt (/api/goods-receipt)
 *   create/update/delete = draft; post = posting & pembatalan (stok & HPP berubah)
 */
const goodsReceipt = express.Router();
goodsReceipt.get('/po-options', protect, authorize('goodsReceipt', 'view'), gr.getPoOptions);
goodsReceipt.get('/from-po/:poId', protect, authorize('goodsReceipt', 'view'), gr.getPoForReceipt);
goodsReceipt.get('/', protect, authorize('goodsReceipt', 'view'), gr.getGoodsReceipts);
goodsReceipt.get('/:id', protect, authorize('goodsReceipt', 'view'), gr.getGoodsReceipt);
goodsReceipt.post('/', protect, authorize('goodsReceipt', 'create'), gr.createGoodsReceipt);
goodsReceipt.put('/:id', protect, authorize('goodsReceipt', 'update'), gr.updateGoodsReceipt);
goodsReceipt.delete('/:id', protect, authorize('goodsReceipt', 'delete'), gr.deleteGoodsReceipt);
goodsReceipt.post('/:id/post', protect, authorize('goodsReceipt', 'post'), gr.postGoodsReceipt);
goodsReceipt.post('/:id/cancel', protect, authorize('goodsReceipt', 'post'), gr.cancelGoodsReceipt);

module.exports = { purchaseOrder, goodsReceipt };
