const mongoose = require('mongoose');

/**
 * Schema bersama pembayaran gabungan (dipakai models/CustomerReceipt.js & models/VendorPaymentBatch.js): 1 uang masuk / keluar untuk beberapa invoice / tagihan sekaligus.
 *   CustomerReceipt (RCV-…)      : penerimaan dari 1 customer -> SalesPayment PAYMENT per invoice
 *   VendorPaymentBatch (VPB-…)   : pembayaran ke 1 vendor -> VendorPayment PAYMENT per tagihan
 * Langsung berlaku; jumlah = total alokasi (tidak ada kelebihan / deposit, tidak ada potongan).
 * Batal = semua pembayaran alokasinya dibatalkan sekaligus (alasan wajib).
 */
const makeSchema = (partyField, partyRef, invoiceField, invoiceRef, paymentRef, methods) => {
  const allocationSchema = new mongoose.Schema({
    [invoiceField]: { type: mongoose.Schema.Types.ObjectId, ref: invoiceRef, required: true },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: paymentRef, required: true },
    amount: { type: Number, required: true },
  }, { _id: false });

  const schema = new mongoose.Schema({
    no: { type: String, required: true, unique: true },
    [partyField]: { type: mongoose.Schema.Types.ObjectId, ref: partyRef, required: true },
    date: { type: Date, required: true },
    method: { type: String, enum: methods, required: true },
    amount: { type: Number, required: true },
    reference: { type: String, default: '' },
    note: { type: String, default: '' },
    status: { type: String, enum: ['POSTED', 'CANCELLED'], default: 'POSTED' },
    allocations: [allocationSchema],
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancelledDate: { type: Date, default: null },
    cancelReason: { type: String, default: null },
    createdDate: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedDate: { type: Date, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'User' },
  });
  schema.index({ [partyField]: 1, date: -1 });
  schema.index({ status: 1, createdDate: -1 });
  schema.index({ [`allocations.${invoiceField}`]: 1 });
  return schema;
};

const METHODS = ['CASH', 'TRANSFER', 'OTHER'];

module.exports = { makeSchema, METHODS };
