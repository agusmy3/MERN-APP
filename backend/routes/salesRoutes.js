const express = require('express');
const protect = require('../middlewares/authMiddleware');
const authorize = require('../middlewares/authorize');
const Customer = require('../models/Customer');
const { dropdownHandler } = require('../helpers/dropdownHelper');
const cust = require('../controllers/customerController');
const inv = require('../controllers/salesInvoiceController');

/** Customer (/api/customer): master data standar; /dropdown cukup login (pilihan di dokumen penjualan) */
const customer = express.Router();
customer.get('/dropdown', protect, dropdownHandler(Customer, '_id code name isActive isWalkIn', { isWalkIn: -1, name: 1 }));
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
salesInvoice.post('/skus/balance', protect, authorize('salesInvoice', 'view'), require('../controllers/stockAdjustmentController').skuBalances);
salesInvoice.get('/', protect, authorize('salesInvoice', 'view'), inv.getInvoices);
salesInvoice.get('/:id', protect, authorize('salesInvoice', 'view'), inv.getInvoice);
salesInvoice.post('/', protect, authorize('salesInvoice', 'create'), inv.createInvoice);
salesInvoice.put('/:id', protect, authorize('salesInvoice', 'update'), inv.updateInvoice);
salesInvoice.delete('/:id', protect, authorize('salesInvoice', 'delete'), inv.deleteInvoice);
salesInvoice.post('/:id/post', protect, authorize('salesInvoice', 'post'), inv.postInvoice);
salesInvoice.post('/:id/cancel', protect, authorize('salesInvoice', 'post'), inv.cancelInvoice);

module.exports = { customer, salesInvoice };
