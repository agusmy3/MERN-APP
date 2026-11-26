const mongoose = require('mongoose');

/**
 * Retur pembelian (PRT-…) atas 1 Goods Receipt POSTED: DRAFT -> POSTED -> CANCELLED. Alasan wajib.
 * Post: stok keluar dari gudang GR (movement PURCHASE_RETURN, HPP = unitCost baris GR -> HPP rata-rata dihitung ulang),
 * GR.lines.qtyReturned bertambah. Nilai (harga PO + PPN) mengurangi tagihan GR jika sudah ditagih, atau
 * mengurangi qty yang nanti ditagih. resolution REPLACE = vendor mengganti barang: qtyReceived PO berkurang
 * (PO terbuka lagi, barang pengganti lewat GR baru); CREDIT = potong tagihan saja.
 */
const lineSchema = new mongoose.Schema({
  poLine: { type: mongoose.Schema.Types.ObjectId, required: true }, // kunci baris GR
  sku: { type: mongoose.Schema.Types.ObjectId, ref: 'ProdukSku', required: true },
  produk: { type: mongoose.Schema.Types.ObjectId, ref: 'Produk', required: true },
  uomBeli: { type: mongoose.Schema.Types.ObjectId, ref: 'Uom', required: true },
  konversi: { type: Number, required: true },
  qty: { type: Number, required: true },        // satuan beli
  qtyBase: { type: Number, required: true },
  unitCost: { type: Number, default: null },    // HPP baris GR per satuan dasar
  amount: { type: Number, default: 0 },         // nilai hutang yang berkurang (harga PO, diskon, PPN)
  note: { type: String },
}, { _id: false });

const purchaseReturnSchema = new mongoose.Schema({
  no: { type: String, required: true, unique: true },
  goodsReceipt: { type: mongoose.Schema.Types.ObjectId, ref: 'GoodsReceipt', required: true },
  purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true },
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
  gudang: { type: mongoose.Schema.Types.ObjectId, ref: 'Gudang', required: true },
  date: { type: Date, required: true },
  reason: { type: String, required: true },
  resolution: { type: String, enum: ['CREDIT', 'REPLACE'], default: 'CREDIT' },
  status: { type: String, enum: ['DRAFT', 'POSTED', 'CANCELLED'], default: 'DRAFT' },
  lines: [lineSchema],
  total: { type: Number, default: 0 },          // jumlah amount
  purchaseInvoice: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseInvoice', default: null }, // tagihan yang dikurangi
  note: { type: String, default: '' },
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

purchaseReturnSchema.index({ goodsReceipt: 1, status: 1 });
purchaseReturnSchema.index({ status: 1, createdDate: -1 });
purchaseReturnSchema.index({ 'lines.sku': 1 });

module.exports = mongoose.model('PurchaseReturn', purchaseReturnSchema);
