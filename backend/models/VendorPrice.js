const mongoose = require('mongoose');

/**
 * Harga beli sebuah SKU dari sebuah Vendor (supplier price list). Hanya harga terkini;
 * perubahan tercatat lewat field audit.
 *
 * Satuan beli bisa berbeda dari satuan stok/jual: mis. beli per BOX (uomBeli) isi 12 (konversi)
 * satuan dasar produk (PCS). Harga pokok per satuan dasar = hargaBeli / konversi.
 */
const vendorPriceSchema = new mongoose.Schema({
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
  // disalin dari SKU agar mudah dicari per produk
  produk: { type: mongoose.Schema.Types.ObjectId, ref: 'Produk', required: true, index: true },
  sku: { type: mongoose.Schema.Types.ObjectId, ref: 'ProdukSku', required: true, index: true },
  uomBeli: { type: mongoose.Schema.Types.ObjectId, ref: 'Uom', required: true },
  konversi: { type: Number, required: true, min: 1 },   // 1 uomBeli = konversi x satuan dasar produk
  hargaBeli: { type: Number, required: true, min: 0 },  // per uomBeli
  isPreferred: { type: Boolean, default: false },       // vendor utama untuk SKU ini (maks. 1 per SKU)
  minOrder: { type: Number, default: null, min: 0 },    // dalam uomBeli
  catatan: { type: String },
  createdDate: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedDate: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'User' }
});

// 1 vendor bisa menjual SKU yang sama dalam satuan berbeda (mis. per BOX dan per PCS)
vendorPriceSchema.index({ vendor: 1, sku: 1, uomBeli: 1 }, { unique: true });

module.exports = mongoose.model('VendorPrice', vendorPriceSchema);
