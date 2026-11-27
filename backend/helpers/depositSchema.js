const mongoose = require('mongoose');
const { round2 } = require('./number');

/**
 * Schema bersama deposit / uang muka (models/CustomerDeposit.js DEP-…, models/VendorDeposit.js VDP-…).
 * Saldo = amount - usedAmount - refundedAmount (`depositBalance`).
 * Asal (`source`):
 *   DIRECT      : uang muka dicatat langsung (opsional ditautkan ke SO / PO sebagai info)
 *   BATCH       : kelebihan uang di pembayaran gabungan (`batch`; batal lewat pembayaran gabungannya)
 *   OVERPAYMENT : kelebihan bayar invoice / tagihan dipindah ke deposit (`<invoice>` + pembayaran REFUND metode DEPOSIT)
 * Dipakai = pembayaran PAYMENT metode DEPOSIT (`usedAmount`); dikembalikan = `refunds` (uang keluar / masuk lagi).
 * Batal hanya selama belum dipakai & belum dikembalikan.
 */
const makeDepositSchema = ({ partyField, partyRef, invoiceField, invoiceRef, orderField, orderRef, batchRef }) => {
  const refundSchema = new mongoose.Schema({
    date: { type: Date, required: true },
    method: { type: String, enum: ['CASH', 'TRANSFER', 'OTHER'], required: true },
    amount: { type: Number, required: true },
    reference: { type: String, default: '' },
    note: { type: String, default: '' },
    status: { type: String, enum: ['POSTED', 'CANCELLED'], default: 'POSTED' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdDate: { type: Date, default: Date.now },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancelledDate: { type: Date, default: null },
    cancelReason: { type: String, default: null },
  });

  const schema = new mongoose.Schema({
    no: { type: String, required: true, unique: true },
    [partyField]: { type: mongoose.Schema.Types.ObjectId, ref: partyRef, required: true },
    date: { type: Date, required: true },
    source: { type: String, enum: ['DIRECT', 'BATCH', 'OVERPAYMENT'], default: 'DIRECT' },
    method: { type: String, enum: ['CASH', 'TRANSFER', 'OTHER', null], default: null }, // null = OVERPAYMENT (bukan uang baru)
    amount: { type: Number, required: true },
    usedAmount: { type: Number, default: 0 },
    refundedAmount: { type: Number, default: 0 },
    [orderField]: { type: mongoose.Schema.Types.ObjectId, ref: orderRef, default: null },     // info: uang muka untuk pesanan ini
    batch: { type: mongoose.Schema.Types.ObjectId, ref: batchRef, default: null },           // source BATCH
    [invoiceField]: { type: mongoose.Schema.Types.ObjectId, ref: invoiceRef, default: null }, // source OVERPAYMENT
    reference: { type: String, default: '' },
    note: { type: String, default: '' },
    status: { type: String, enum: ['POSTED', 'CANCELLED'], default: 'POSTED' },
    refunds: [refundSchema],
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    cancelledDate: { type: Date, default: null },
    cancelReason: { type: String, default: null },
    createdDate: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedDate: { type: Date, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'User' },
  });
  schema.index({ [partyField]: 1, status: 1, date: 1 });
  schema.index({ status: 1, createdDate: -1 });
  return schema;
};

/** Saldo deposit yang masih bisa dipakai / dikembalikan */
const depositBalance = (d) => (d.status === 'POSTED' ? round2((d.amount || 0) - (d.usedAmount || 0) - (d.refundedAmount || 0)) : 0);

module.exports = { makeDepositSchema, depositBalance };
