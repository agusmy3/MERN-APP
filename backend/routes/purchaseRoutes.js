const express = require('express');
const protect = require('../middlewares/authMiddleware');
const authorize = require('../middlewares/authorize');
const po = require('../controllers/purchaseOrderController');
const gr = require('../controllers/goodsReceiptController');
const bill = require('../controllers/purchaseInvoiceController');
const vpay = require('../controllers/vendorPaymentController');
const prt = require('../controllers/purchaseReturnController');
// tagihan & pembayaran vendor = data harga beli
const cost = authorize('vendorPrice', 'view');

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

/**
 * Vendor Bill (/api/purchase-invoice) — tagihan vendor dari GR (langsung berlaku); update = batalkan
 */
const purchaseInvoice = express.Router();
purchaseInvoice.get('/billable', protect, authorize('purchaseInvoice', 'view'), cost, bill.getBillable);
purchaseInvoice.get('/aging', protect, authorize('purchaseInvoice', 'view'), cost, bill.getAging);
purchaseInvoice.get('/', protect, authorize('purchaseInvoice', 'view'), cost, bill.getInvoices);
purchaseInvoice.get('/:id', protect, authorize('purchaseInvoice', 'view'), cost, bill.getInvoice);
purchaseInvoice.post('/', protect, authorize('purchaseInvoice', 'create'), cost, bill.createInvoice);
purchaseInvoice.post('/:id/cancel', protect, authorize('purchaseInvoice', 'update'), cost, bill.cancelInvoice);

/** Vendor Payment (/api/vendor-payment) — create = catat; update = batalkan */
const vendorPayment = express.Router();
vendorPayment.get('/', protect, authorize('vendorPayment', 'view'), cost, vpay.getPayments);
vendorPayment.post('/', protect, authorize('vendorPayment', 'create'), cost, vpay.createPayment);
vendorPayment.post('/:id/cancel', protect, authorize('vendorPayment', 'update'), cost, vpay.cancelPayment);

/** Purchase Return (/api/purchase-return) — create/update/delete = draft; post = posting & pembatalan */
const purchaseReturn = express.Router();
purchaseReturn.get('/gr-options', protect, authorize('purchaseReturn', 'view'), prt.getGrOptions);
purchaseReturn.get('/from-gr/:grId', protect, authorize('purchaseReturn', 'view'), prt.getGrForReturn);
purchaseReturn.get('/', protect, authorize('purchaseReturn', 'view'), prt.getReturns);
purchaseReturn.get('/:id', protect, authorize('purchaseReturn', 'view'), prt.getReturn);
purchaseReturn.post('/', protect, authorize('purchaseReturn', 'create'), prt.createReturn);
purchaseReturn.put('/:id', protect, authorize('purchaseReturn', 'update'), prt.updateReturn);
purchaseReturn.delete('/:id', protect, authorize('purchaseReturn', 'delete'), prt.deleteReturn);
purchaseReturn.post('/:id/post', protect, authorize('purchaseReturn', 'post'), prt.postReturn);
purchaseReturn.post('/:id/cancel', protect, authorize('purchaseReturn', 'post'), prt.cancelReturn);

module.exports = { purchaseOrder, goodsReceipt, purchaseInvoice, vendorPayment, purchaseReturn };
