const mongoose = require('mongoose');
const { makeDepositSchema } = require('../helpers/depositSchema');

/** Uang muka ke vendor (VDP-…). Lihat helpers/depositSchema.js */
module.exports = mongoose.model('VendorDeposit', makeDepositSchema({
  partyField: 'vendor', partyRef: 'Vendor', invoiceField: 'purchaseInvoice', invoiceRef: 'PurchaseInvoice',
  orderField: 'purchaseOrder', orderRef: 'PurchaseOrder', batchRef: 'VendorPaymentBatch',
}));
