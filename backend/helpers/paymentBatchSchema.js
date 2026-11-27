const mongoose = require('mongoose');

/**
 * Schema bersama pembayaran gabungan (dipakai models/CustomerReceipt.js & models/VendorPaymentBatch.js): 1 uang masuk / keluar untuk beberapa invoice / tagihan sekaligus.
 *   CustomerReceipt (RCV-…)      : penerimaan dari 1 customer -> SalesPayment PAYMENT per invoice
 *   VendorPaymentBatch (VPB-…)   : pembayaran ke 1 vendor -> VendorPayment PAYMENT per tagihan
 * Langsung berlaku. Dana = uang baru (`amount`) + saldo deposit yang dipakai (`deposits`); alokasi dibayar dari deposit
 * dulu lalu uang baru; sisa uang baru = deposit baru (`depositCreated`). Tiap alokasi boleh diberi potongan (write-off).
 * Batal = semua pembayaran alokasinya dibatalkan sekaligus (alasan wajib).
 */
const makeSchema = (partyField, partyRef, invoiceField, invoiceRef, paymentRef, methods, depositRef) => {
  const allocationSchema = new mongoose.Schema({
    [invoiceField]: { type: mongoose.Schema.Types.ObjectId, ref: invoiceRef, required: true },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: paymentRef, default: null }, // pembayaran pertama (data lama: satu-satunya)
    payments: [{ type: mongoose.Schema.Types.ObjectId, ref: paymentRef }],            // semua: dari deposit lalu dari uang ini
    amount: { type: Number, required: true },        // uang + deposit untuk invoice ini
    writeOff: { type: Number, default: 0 },          // potongan untuk invoice ini
    writeOffReason: { type: String, default: null },
  }, { _id: false });
  const depositUseSchema = new mongoose.Schema({
    deposit: { type: mongoose.Schema.Types.ObjectId, ref: depositRef, required: true },
    amount: { type: Number, required: true },
  }, { _id: false });

  const schema = new mongoose.Schema({
    no: { type: String, required: true, unique: true },
    [partyField]: { type: mongoose.Schema.Types.ObjectId, ref: partyRef, required: true },
    date: { type: Date, required: true },
    method: { type: String, enum: methods, required: true },
    amount: { type: Number, required: true },       // uang baru (boleh 0 jika semua dari deposit / potongan)
    deposits: [depositUseSchema],                   // saldo deposit yang ikut dipakai
    depositCreated: { type: mongoose.Schema.Types.ObjectId, ref: depositRef, default: null }, // kelebihan uang -> deposit baru
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
