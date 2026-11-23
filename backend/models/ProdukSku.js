const mongoose = require('mongoose');

const variantValueSchema = new mongoose.Schema({
  variant: { type: mongoose.Schema.Types.ObjectId, ref: 'Variant', required: true },
  value: { type: String, required: true },
}, { _id: false });

/**
 * SKU = unit yang distok & dijual: 1 kombinasi nilai varian dari sebuah Produk.
 * Harga jual & stok dalam satuan dasar produk (Produk.uom).
 */
const produkSkuSchema = new mongoose.Schema({
  produk: { type: mongoose.Schema.Types.ObjectId, ref: 'Produk', required: true, index: true },
  sku: { type: String, required: true, unique: true, uppercase: true, trim: true }, // mis. KAOS-POLOS-MERAH-M
  variantValues: { type: [variantValueSchema], default: [] }, // kosong = SKU default (produk tanpa varian)
  // kunci kombinasi varian (lihat helpers/skuHelper.js) supaya kombinasi tidak dobel dalam 1 produk
  comboKey: { type: String, default: '' },
  hargaJual: { type: Number, default: 0, min: 0 },
  stok: { type: Number, default: 0, min: 0 },
  isActive: { type: Boolean, default: true },
  createdDate: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedDate: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'User' }
});

produkSkuSchema.index({ produk: 1, comboKey: 1 }, { unique: true });

module.exports = mongoose.model('ProdukSku', produkSkuSchema);
