const mongoose = require('mongoose');
const { makeSchema, METHODS } = require('../helpers/paymentBatchSchema');

/** Penerimaan pembayaran gabungan dari 1 customer (RCV-…) -> SalesPayment per invoice. Lihat helpers/paymentBatchSchema.js */
module.exports = mongoose.model('CustomerReceipt', makeSchema('customer', 'Customer', 'salesInvoice', 'SalesInvoice', 'SalesPayment', METHODS));
