const mongoose = require('mongoose');

/**
 * Penjualan langsung (barang keluar + invoice dalam 1 dokumen), 1 dokumen = 1 gudang:
 *   DRAFT --post--> POSTED --cancel--> CANCELLED
 * Draft bisa diedit/dihapus tanpa mengubah stok.
 *
 * - post   : movement SALE (-qty) di gudang; HPP saat itu disimpan per baris (unitCost) -> cogs & laba kotor
 * - cancel : movement pembalik (+qty) dengan unitCost yang sama
 * Harga & qty dalam satuan dasar produk. Pajak (salinan System Settings saat dokumen dibuat):
 * - priceIncludesTax = false : dpp = subtotal - diskon dokumen, PPN = dpp x tarif, total = dpp + PPN
 * - priceIncludesTax = true  : total = subtotal - diskon dokumen, PPN = total x tarif / (100 + tarif), dpp = total - PPN
 * Pendapatan bersih = dpp (tanpa PPN); laba kotor = dpp - cogs. Lihat helpers/salesHelper.js.
 */
const lineSchema = new mongoose.Schema({
  sku: { type: mongoose.Schema.Types.ObjectId, ref: 'ProdukSku', required: true },
  produk: { type: mongoose.Schema.Types.ObjectId, ref: 'Produk', required: true },
  qty: { type: Number, required: true },
  hargaJual: { type: Number, required: true },        // per satuan dasar
  diskonPersen: { type: Number, default: 0 },
  subtotal: { type: Number, required: true },         // qty x harga x (1 - diskon%)
  unitCost: { type: Number, default: null },          // HPP saat post (data biaya)
  qtyReturned: { type: Number, default: 0 },          // total retur POSTED (Sales Return)
  note: { type: String },
}, { _id: false });

const salesInvoiceSchema = new mongoose.Schema({
  no: { type: String, required: true, unique: true },  // INV-202611-0001
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  gudang: { type: mongoose.Schema.Types.ObjectId, ref: 'Gudang', required: true },
  date: { type: Date, required: true },
  status: { type: String, required: true, enum: ['DRAFT', 'POSTED', 'CANCELLED'], default: 'DRAFT' },
  priceIncludesTax: { type: Boolean, default: false },
  taxRate: { type: Number, default: 0 },
  lines: { type: [lineSchema], default: [] },
  subtotal: { type: Number, default: 0 },
  discountAmount: { type: Number, default: 0 },        // diskon dokumen (nominal)
  dpp: { type: Number, default: 0 },                   // dasar pengenaan pajak = pendapatan bersih
  taxAmount: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  cogs: { type: Number, default: null },               // HPP penjualan, diisi saat post (data biaya)
  // piutang (helpers/salesHelper.js invoiceBalance): sisa = total - returnedAmount - paidAmount
  dueDate: { type: Date, default: null },
  returnedAmount: { type: Number, default: 0 },        // nilai retur POSTED (termasuk PPN)
  paidAmount: { type: Number, default: 0 },            // pembayaran POSTED dikurangi refund
  paymentStatus: { type: String, enum: ['UNPAID', 'PARTIAL', 'PAID', 'OVERPAID', null], default: null }, // null = belum diposting
  note: { type: String },
  postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  postedDate: { type: Date, default: null },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  cancelledDate: { type: Date, default: null },
  cancelReason: { type: String, default: null },
  createdDate: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedDate: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'User' },
});

salesInvoiceSchema.index({ status: 1, date: -1 });
salesInvoiceSchema.index({ gudang: 1, status: 1 });
salesInvoiceSchema.index({ customer: 1 });
salesInvoiceSchema.index({ status: 1, paymentStatus: 1, dueDate: 1 });
salesInvoiceSchema.index({ 'lines.sku': 1 });

module.exports = mongoose.model('SalesInvoice', salesInvoiceSchema);
