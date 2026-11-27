const mongoose = require('mongoose');

/**
 * Sales Order: pesanan customer, TIDAK mengubah stok (stok keluar di Delivery Order). 1 SO = 1 customer + 1 gudang.
 *   DRAFT --confirm--> OPEN --DO posted--> PARTIAL --> DELIVERED
 *   OPEN --cancel--> CANCELLED (belum ada pengiriman);  PARTIAL --close--> CLOSED (sisa tidak dikirim)
 * Hanya DRAFT yang bisa diedit / dihapus. Harga dibekukan seperti Sales Invoice (price list customer /
 * harga jual SKU, dihitung ulang setiap draft disimpan); potongan hanya lewat diskon baris & dokumen.
 * Qty dalam satuan dasar produk. Pajak disalin dari System Settings saat dibuat (bisa diubah selama draft).
 * Ongkir (shippingCharge) ditagih penuh di invoice PERTAMA dari SO ini.
 */
const lineSchema = new mongoose.Schema({
  sku: { type: mongoose.Schema.Types.ObjectId, ref: 'ProdukSku', required: true },
  produk: { type: mongoose.Schema.Types.ObjectId, ref: 'Produk', required: true },
  qty: { type: Number, required: true },
  uom: { type: mongoose.Schema.Types.ObjectId, ref: 'Uom', default: null }, // satuan jual (null = satuan dasar, data lama)
  konversi: { type: Number, default: 1 },        // isi satuan jual dalam satuan dasar
  qtyUom: { type: Number, default: null },       // qty dalam satuan jual (null = qty); qty = satuan dasar
  hargaJual: { type: Number, required: true },   // per satuan jual
  diskonPersen: { type: Number, default: 0 },
  subtotal: { type: Number, required: true },
  qtyDelivered: { type: Number, default: 0 },   // total DO POSTED
  note: { type: String },
});  // _id per baris: dirujuk surat jalan (soLine) / retur (invoiceLine)

// alamat kirim (salinan; default dari alamat customer)
const shipToSchema = new mongoose.Schema({
  name: { type: String, default: '' },       // penerima
  phone: { type: String, default: '' },
  alamat: { type: String, default: '' },
  provinsi: { type: String, default: '' },
  kota: { type: String, default: '' },
  kecamatan: { type: String, default: '' },
  kelurahan: { type: String, default: '' },
  regionCode: { type: String, default: null },
  kodePos: { type: String, default: '' },
  latitude: { type: Number, default: null },
  longitude: { type: Number, default: null },
}, { _id: false });

const salesOrderSchema = new mongoose.Schema({
  no: { type: String, required: true, unique: true },   // SO-202611-0001
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  gudang: { type: mongoose.Schema.Types.ObjectId, ref: 'Gudang', required: true },
  date: { type: Date, required: true },
  requestedDate: { type: Date, default: null },          // tanggal kirim yang diminta customer
  customerPoNo: { type: String, default: '' },           // no. PO dari customer
  deliveryMethod: { type: String, enum: ['DELIVERY', 'PICKUP'], default: 'DELIVERY' },
  shipTo: { type: shipToSchema, default: () => ({}) },
  status: {
    type: String, required: true, default: 'DRAFT',
    enum: ['DRAFT', 'OPEN', 'PARTIAL', 'DELIVERED', 'CLOSED', 'CANCELLED'],
  },
  priceIncludesTax: { type: Boolean, default: false },
  taxRate: { type: Number, default: 0 },
  lines: { type: [lineSchema], default: [] },
  subtotal: { type: Number, default: 0 },
  discountAmount: { type: Number, default: 0 },
  dpp: { type: Number, default: 0 },            // DPP barang
  taxAmount: { type: Number, default: 0 },
  total: { type: Number, default: 0 },          // barang + ongkir, termasuk PPN
  shippingCharge: { type: Number, default: 0 },
  shippingDpp: { type: Number, default: 0 },
  shippingTotal: { type: Number, default: 0 },
  note: { type: String },
  quotation: { type: mongoose.Schema.Types.ObjectId, ref: 'Quotation', default: null }, // dibuat dari penawaran (harga penawaran dipakai)
  confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  confirmedDate: { type: Date, default: null },
  // konfirmasi melewati batas kredit / invoice lewat jatuh tempo (izin salesOrder:approve)
  creditOverrideReason: { type: String, default: null },
  creditOverrideNote: { type: String, default: null },   // ringkasan posisi kredit saat disetujui
  creditOverrideBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  creditOverrideDate: { type: Date, default: null },
  closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  closedDate: { type: Date, default: null },
  closeReason: { type: String, default: null },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  cancelledDate: { type: Date, default: null },
  cancelReason: { type: String, default: null },
  createdDate: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedDate: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'User' },
});

salesOrderSchema.index({ status: 1, date: -1 });
salesOrderSchema.index({ gudang: 1, status: 1 });
salesOrderSchema.index({ customer: 1 });
salesOrderSchema.index({ 'lines.sku': 1, status: 1 });

module.exports = mongoose.model('SalesOrder', salesOrderSchema);
module.exports.shipToSchema = shipToSchema;
