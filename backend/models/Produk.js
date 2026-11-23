const mongoose = require('mongoose');

/**
 * Produk = induk (mis. "Kaos Polos"). Yang distok, dijual, dan dibeli dari vendor adalah
 * ProdukSku (kombinasi varian, mis. KAOS-POLOS-MERAH-M). Produk tanpa varian punya 1 SKU default.
 * Harga jual & stok ada di ProdukSku; harga beli per vendor ada di VendorPrice.
 */
const produkSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  deskripsi: { type: String },
  kategori: { type: mongoose.Schema.Types.ObjectId, ref: 'Kategori', required: true },
  // satuan dasar stok & jual (mis. PCS); harga beli vendor dikonversi ke satuan ini
  uom: { type: mongoose.Schema.Types.ObjectId, ref: 'Uom', required: true },
  // jenis varian yang dipakai (mis. [COLOR, SIZE]); kosong = produk tanpa varian
  variants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Variant' }],
  createdDate: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedDate: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "User" }
});

module.exports = mongoose.model('Produk', produkSchema);
