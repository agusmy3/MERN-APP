const mongoose = require('mongoose');
const { makeSchema, METHODS } = require('../helpers/paymentBatchSchema');

/** Pembayaran gabungan ke 1 vendor (VPB-…) -> VendorPayment per tagihan. Lihat helpers/paymentBatchSchema.js */
module.exports = mongoose.model('VendorPaymentBatch', makeSchema('vendor', 'Vendor', 'purchaseInvoice', 'PurchaseInvoice', 'VendorPayment', METHODS, 'VendorDeposit'));
