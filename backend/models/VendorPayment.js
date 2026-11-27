const mongoose = require('mongoose');

/**
 * Pembayaran ke vendor (VPAY-…) atau refund dari vendor (VRF-…, kelebihan bayar mis. retur setelah lunas)
 * untuk 1 tagihan (boleh dicicil). Langsung berlaku; batal dengan alasan.
 */
const vendorPaymentSchema = new mongoose.Schema({
  no: { type: String, required: true, unique: true },
  type: { type: String, enum: ['PAYMENT', 'REFUND'], default: 'PAYMENT' },
  purchaseInvoice: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseInvoice', required: true },
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
  batch: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorPaymentBatch', default: null }, // bagian dari pembayaran gabungan
  date: { type: Date, required: true },
  // DEPOSIT = dibayar dari uang muka ke vendor (PAYMENT) / kelebihan bayar dipindah ke uang muka (REFUND); null = hanya potongan
  method: { type: String, enum: ['CASH', 'TRANSFER', 'OTHER', 'DEPOSIT', null], default: null },
  deposit: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorDeposit', default: null },
  amount: { type: Number, required: true },     // uang (>= 0); 0 hanya jika ada potongan
  writeOffAmount: { type: Number, default: 0 }, // potongan dari vendor (mengurangi sisa tagihan, bukan uang keluar)
  writeOffReason: { type: String, enum: ['DISCOUNT', 'ROUNDING', 'OTHER', null], default: null },
  reference: { type: String, default: '' },
  note: { type: String, default: '' },
  status: { type: String, enum: ['POSTED', 'CANCELLED'], default: 'POSTED' },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  cancelledDate: { type: Date, default: null },
  cancelReason: { type: String, default: null },
  createdDate: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedDate: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'User' },
});

vendorPaymentSchema.index({ purchaseInvoice: 1, status: 1 });
vendorPaymentSchema.index({ vendor: 1, date: -1 });
vendorPaymentSchema.index({ deposit: 1, status: 1 });

module.exports = mongoose.model('VendorPayment', vendorPaymentSchema);
