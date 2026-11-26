const mongoose = require('mongoose');

/**
 * Quotation / penawaran harga (QUO-…), TIDAK mengubah stok & tidak dihitung sebagai pesanan.
 *   DRAFT --send--> SENT --convert--> ACCEPTED (Sales Order draft dibuat dari penawaran ini)
 *   SENT --reject--> REJECTED;  SENT --revise--> DRAFT
 *   SENT yang lewat validUntil = kedaluwarsa (dihitung saat dibaca, tidak bisa dikonversi; revise untuk memperpanjang).
 * Harga dibekukan seperti SO (price list customer / harga jual SKU, dihitung ulang setiap draft disimpan) dan
 * DIKUNCI sejak dikirim: SO hasil konversi memakai harga penawaran ini.
 * Customer boleh walk-in (calon pembeli: prospectName / prospectContact), tapi harus diganti customer bernama saat dikonversi.
 */
const lineSchema = new mongoose.Schema({
  sku: { type: mongoose.Schema.Types.ObjectId, ref: 'ProdukSku', required: true },
  produk: { type: mongoose.Schema.Types.ObjectId, ref: 'Produk', required: true },
  qty: { type: Number, required: true },
  hargaJual: { type: Number, required: true },
  diskonPersen: { type: Number, default: 0 },
  subtotal: { type: Number, required: true },
  note: { type: String },
}, { _id: false });

const quotationSchema = new mongoose.Schema({
  no: { type: String, required: true, unique: true },  // QUO-202611-0001
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  prospectName: { type: String, default: '' },     // calon pembeli (customer walk-in)
  prospectContact: { type: String, default: '' },
  gudang: { type: mongoose.Schema.Types.ObjectId, ref: 'Gudang', required: true }, // gudang pengirim (info stok, disalin ke SO)
  date: { type: Date, required: true },
  validUntil: { type: Date, required: true },
  deliveryMethod: { type: String, enum: ['DELIVERY', 'PICKUP'], default: 'DELIVERY' },
  status: { type: String, enum: ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED'], default: 'DRAFT' },
  priceIncludesTax: { type: Boolean, default: false },
  taxRate: { type: Number, default: 0 },
  lines: [lineSchema],
  subtotal: { type: Number, default: 0 },
  discountAmount: { type: Number, default: 0 },
  dpp: { type: Number, default: 0 },
  taxAmount: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  shippingCharge: { type: Number, default: 0 },
  shippingDpp: { type: Number, default: 0 },
  shippingTotal: { type: Number, default: 0 },
  note: { type: String, default: '' },
  terms: { type: String, default: '' },              // syarat penawaran (dicetak)
  salesOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'SalesOrder', default: null }, // hasil konversi
  sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  sentDate: { type: Date, default: null },
  acceptedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  acceptedDate: { type: Date, default: null },
  rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  rejectedDate: { type: Date, default: null },
  rejectReason: { type: String, default: null },
  createdDate: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedDate: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'User' },
});

quotationSchema.index({ status: 1, validUntil: 1 });
quotationSchema.index({ customer: 1 });
quotationSchema.index({ date: -1 });

module.exports = mongoose.model('Quotation', quotationSchema);
