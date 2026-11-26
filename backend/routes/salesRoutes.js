const express = require('express');
const protect = require('../middlewares/authMiddleware');
const authorize = require('../middlewares/authorize');
const Customer = require('../models/Customer');
const { dropdownHandler } = require('../helpers/dropdownHelper');
const cust = require('../controllers/customerController');
const inv = require('../controllers/salesInvoiceController');
const ret = require('../controllers/salesReturnController');
const pay = require('../controllers/salesPaymentController');
const pl = require('../controllers/priceListController');
const PriceList = require('../models/PriceList');
const report = require('../controllers/salesReportController');
const quo = require('../controllers/quotationController');
const so = require('../controllers/salesOrderController');
const dlv = require('../controllers/deliveryOrderController');

/**
 * Sales Order (/api/sales-order) — pesanan customer (tidak mengubah stok)
 *   create = draft / langsung konfirmasi; update = ubah draft, konfirmasi, cancel, close; delete = hapus draft
 */
const salesOrder = express.Router();
salesOrder.get('/skus', protect, authorize('salesOrder', 'view'), so.searchSkus);
salesOrder.post('/skus/prices', protect, authorize('salesOrder', 'view'), inv.skuPrices);
salesOrder.post('/skus/availability', protect, authorize('salesOrder', 'view'), so.skuAvailability);
salesOrder.get('/ship-to/:customerId', protect, authorize('salesOrder', 'view'), so.getCustomerShipTo);
salesOrder.get('/', protect, authorize('salesOrder', 'view'), so.getSalesOrders);
salesOrder.get('/:id', protect, authorize('salesOrder', 'view'), so.getSalesOrder);
salesOrder.post('/', protect, authorize('salesOrder', 'create'), so.createSalesOrder);
salesOrder.put('/:id', protect, authorize('salesOrder', 'update'), so.updateSalesOrder);
salesOrder.delete('/:id', protect, authorize('salesOrder', 'delete'), so.deleteSalesOrder);
salesOrder.post('/:id/confirm', protect, authorize('salesOrder', 'update'), so.confirmSalesOrder);
salesOrder.post('/:id/cancel', protect, authorize('salesOrder', 'update'), so.cancelSalesOrder);
salesOrder.post('/:id/close', protect, authorize('salesOrder', 'update'), so.closeSalesOrder);

/**
 * Delivery Order (/api/delivery-order) — surat jalan atas SO
 *   create/update/delete = draft; post = posting & pembatalan (stok keluar / kembali)
 *   POST /:id/invoice = buat invoice POSTED (dicek di handler: salesInvoice create + post)
 *   POST /invoice { deliveryOrders: [] } = invoice gabungan beberapa DO (customer & gudang sama)
 */
const deliveryOrder = express.Router();
deliveryOrder.get('/so-options', protect, authorize('deliveryOrder', 'view'), dlv.getSoOptions);
deliveryOrder.get('/from-so/:soId', protect, authorize('deliveryOrder', 'view'), dlv.getSoForDelivery);
deliveryOrder.get('/', protect, authorize('deliveryOrder', 'view'), dlv.getDeliveryOrders);
deliveryOrder.get('/:id', protect, authorize('deliveryOrder', 'view'), dlv.getDeliveryOrder);
deliveryOrder.post('/', protect, authorize('deliveryOrder', 'create'), dlv.createDeliveryOrder);
deliveryOrder.put('/:id', protect, authorize('deliveryOrder', 'update'), dlv.updateDeliveryOrder);
deliveryOrder.delete('/:id', protect, authorize('deliveryOrder', 'delete'), dlv.deleteDeliveryOrder);
deliveryOrder.post('/:id/post', protect, authorize('deliveryOrder', 'post'), dlv.postDeliveryOrder);
deliveryOrder.post('/:id/cancel', protect, authorize('deliveryOrder', 'post'), dlv.cancelDeliveryOrder);
deliveryOrder.post('/invoice', protect, authorize('deliveryOrder', 'view'), dlv.createCombinedInvoice);
deliveryOrder.post('/:id/invoice', protect, authorize('deliveryOrder', 'view'), dlv.createInvoice);

/** Customer (/api/customer): master data standar; /dropdown cukup login (pilihan di dokumen penjualan) */
const customer = express.Router();
customer.get('/dropdown', protect, dropdownHandler(Customer, '_id code name isActive isWalkIn termDays', { isWalkIn: -1, name: 1 }));
customer.get('/', protect, authorize('customer', 'view'), cust.getCustomers);
customer.get('/:id', protect, authorize('customer', 'view'), cust.getCustomer);
customer.post('/', protect, authorize('customer', 'create'), cust.createCustomer);
customer.put('/:id', protect, authorize('customer', 'update'), cust.updateCustomer);
customer.delete('/:id', protect, authorize('customer', 'delete'), cust.deleteCustomer);

/**
 * Sales Invoice (/api/sales-invoice) — penjualan langsung
 *   create/update/delete = draft; post = posting & pembatalan (stok keluar / kembali)
 */
const salesInvoice = express.Router();
salesInvoice.get('/skus', protect, authorize('salesInvoice', 'view'), inv.searchSkus);
// saldo SKU di gudang (handler Stock Adjustment, cek akses gudang di dalamnya)
salesInvoice.post('/skus/prices', protect, authorize('salesInvoice', 'view'), inv.skuPrices);
salesInvoice.post('/skus/balance', protect, authorize('salesInvoice', 'view'), require('../controllers/stockAdjustmentController').skuBalances);
salesInvoice.get('/', protect, authorize('salesInvoice', 'view'), inv.getInvoices);
salesInvoice.get('/:id', protect, authorize('salesInvoice', 'view'), inv.getInvoice);
salesInvoice.post('/', protect, authorize('salesInvoice', 'create'), inv.createInvoice);
salesInvoice.put('/:id', protect, authorize('salesInvoice', 'update'), inv.updateInvoice);
salesInvoice.delete('/:id', protect, authorize('salesInvoice', 'delete'), inv.deleteInvoice);
salesInvoice.post('/:id/post', protect, authorize('salesInvoice', 'post'), inv.postInvoice);
salesInvoice.post('/:id/cancel', protect, authorize('salesInvoice', 'post'), inv.cancelInvoice);

/**
 * Sales Return (/api/sales-return) — retur atas invoice POSTED
 *   create/update/delete = draft; post = posting & pembatalan (stok masuk / keluar lagi, tagihan berubah)
 */
const salesReturn = express.Router();
salesReturn.get('/invoice-options', protect, authorize('salesReturn', 'view'), ret.getInvoiceOptions);
salesReturn.get('/from-invoice/:invoiceId', protect, authorize('salesReturn', 'view'), ret.getInvoiceForReturn);
salesReturn.get('/', protect, authorize('salesReturn', 'view'), ret.getReturns);
salesReturn.get('/:id', protect, authorize('salesReturn', 'view'), ret.getReturn);
salesReturn.post('/', protect, authorize('salesReturn', 'create'), ret.createReturn);
salesReturn.put('/:id', protect, authorize('salesReturn', 'update'), ret.updateReturn);
salesReturn.delete('/:id', protect, authorize('salesReturn', 'delete'), ret.deleteReturn);
salesReturn.post('/:id/post', protect, authorize('salesReturn', 'post'), ret.postReturn);
salesReturn.post('/:id/cancel', protect, authorize('salesReturn', 'post'), ret.cancelReturn);

/**
 * Sales Payment (/api/sales-payment) — pembayaran / refund atas invoice POSTED (langsung berlaku)
 *   create = catat pembayaran / refund; update = batalkan
 */
const salesPayment = express.Router();
salesPayment.get('/', protect, authorize('salesPayment', 'view'), pay.getPayments);
salesPayment.post('/', protect, authorize('salesPayment', 'create'), pay.createPayment);
salesPayment.post('/:id/cancel', protect, authorize('salesPayment', 'update'), pay.cancelPayment);

/** Price List (/api/price-list): master standar; /dropdown cukup login (pilihan di form customer) */
const priceList = express.Router();
priceList.get('/dropdown', protect, dropdownHandler(PriceList, '_id code name isActive', { name: 1 }));
priceList.get('/skus', protect, authorize('priceList', 'view'), pl.searchSkus);
priceList.get('/', protect, authorize('priceList', 'view'), pl.getPriceLists);
priceList.get('/:id', protect, authorize('priceList', 'view'), pl.getPriceList);
priceList.post('/', protect, authorize('priceList', 'create'), pl.createPriceList);
priceList.put('/:id', protect, authorize('priceList', 'update'), pl.updatePriceList);
priceList.delete('/:id', protect, authorize('priceList', 'delete'), pl.deletePriceList);

/** Sales Report (/api/sales-report): penjualan bersih per kelompok & umur piutang (baca saja) */
const salesReport = express.Router();
salesReport.get('/sales', protect, authorize('salesReport', 'view'), report.getSalesReport);
salesReport.get('/aging', protect, authorize('salesReport', 'view'), report.getAgingReport);
salesReport.get('/backorder', protect, authorize('salesReport', 'view'), report.getBackorderReport);
salesReport.get('/delivery', protect, authorize('salesReport', 'view'), report.getDeliveryReport);

/**
 * Quotation (/api/quotation) — penawaran harga; konversi ke SO butuh juga salesOrder:create (dicek di handler)
 */
const quotation = express.Router();
quotation.get('/', protect, authorize('quotation', 'view'), quo.getQuotations);
quotation.get('/skus', protect, authorize('quotation', 'view'), so.searchSkus);
quotation.post('/skus/prices', protect, authorize('quotation', 'view'), inv.skuPrices);
quotation.get('/:id', protect, authorize('quotation', 'view'), quo.getQuotation);
quotation.post('/', protect, authorize('quotation', 'create'), quo.createQuotation);
quotation.put('/:id', protect, authorize('quotation', 'update'), quo.updateQuotation);
quotation.delete('/:id', protect, authorize('quotation', 'delete'), quo.deleteQuotation);
quotation.post('/:id/send', protect, authorize('quotation', 'update'), quo.sendQuotation);
quotation.post('/:id/revise', protect, authorize('quotation', 'update'), quo.reviseQuotation);
quotation.post('/:id/reject', protect, authorize('quotation', 'update'), quo.rejectQuotation);
quotation.post('/:id/convert', protect, authorize('quotation', 'update'), quo.convertQuotation);

module.exports = { quotation, salesOrder, deliveryOrder, customer, salesInvoice, salesReturn, salesPayment, priceList, salesReport };
