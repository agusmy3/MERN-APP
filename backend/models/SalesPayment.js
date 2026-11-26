const mongoose = require('mongoose');

/**
 * Pembayaran (atau refund) atas 1 Sales Invoice POSTED. Langsung berlaku saat dicatat (tanpa draft):
 *   POSTED --cancel--> CANCELLED
 * - PAYMENT : invoice.paidAmount += amount; amount <= sisa tagihan
 * - REFUND  : invoice.paidAmount -= amount (mengembalikan kelebihan bayar, mis. setelah retur);
 *             amount <= kelebihan bayar
 * Status bayar invoice dihitung ulang (helpers/salesHelper.js invoiceBalance). Satu invoice boleh
 * dibayar beberapa kali (cicil). gudang disalin dari invoice (untuk akses gudang).
 */
const salesPaymentSchema = new mongoose.Schema({
  no: { type: String, required: true, unique: true },  // PAY-202611-0001
  type: { type: String, required: true, enum: ['PAYMENT', 'REFUND'], default: 'PAYMENT' },
  salesInvoice: { type: mongoose.Schema.Types.ObjectId, ref: 'SalesInvoice', required: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  gudang: { type: mongoose.Schema.Types.ObjectId, ref: 'Gudang', required: true },
  date: { type: Date, required: true },
  method: { type: String, required: true, enum: ['CASH', 'CARD', 'QRIS', 'TRANSFER', 'OTHER'] },
  shift: { type: mongoose.Schema.Types.ObjectId, ref: 'PosShift', default: null }, // POS: masuk laci shift ini
  batch: { type: mongoose.Schema.Types.ObjectId, ref: 'CustomerReceipt', default: null }, // bagian dari penerimaan gabungan
  amount: { type: Number, required: true },            // selalu positif
  reference: { type: String, default: '' },            // no. bukti transfer / kuitansi
  note: { type: String, default: '' },
  status: { type: String, required: true, enum: ['POSTED', 'CANCELLED'], default: 'POSTED' },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  cancelledDate: { type: Date, default: null },
  cancelReason: { type: String, default: null },
  createdDate: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedDate: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'User' },
});

salesPaymentSchema.index({ salesInvoice: 1, status: 1 });
salesPaymentSchema.index({ status: 1, date: -1 });
salesPaymentSchema.index({ customer: 1 });
salesPaymentSchema.index({ shift: 1, status: 1 });

module.exports = mongoose.model('SalesPayment', salesPaymentSchema);
