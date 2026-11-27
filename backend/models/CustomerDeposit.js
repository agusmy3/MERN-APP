const mongoose = require('mongoose');
const { makeDepositSchema } = require('../helpers/depositSchema');

/** Deposit / uang muka customer (DEP-…). Lihat helpers/depositSchema.js */
module.exports = mongoose.model('CustomerDeposit', makeDepositSchema({
  partyField: 'customer', partyRef: 'Customer', invoiceField: 'salesInvoice', invoiceRef: 'SalesInvoice',
  orderField: 'salesOrder', orderRef: 'SalesOrder', batchRef: 'CustomerReceipt',
}));
