const mongoose = require('mongoose');

/**
 * Daftar harga jual khusus (mis. "Grosir", "Reseller"). Customer menunjuk ke 0/1 price list
 * (Customer.priceList); banyak customer boleh memakai list yang sama.
 * Harga invoice = harga SKU di price list customer (jika list aktif & SKU ada), selain itu
 * ProdukSku.hargaJual (helpers/priceHelper.js). Harga per satuan dasar, tanpa tingkatan qty / masa berlaku.
 * Item SKU ikut terhapus saat SKU / produknya dihapus.
 */
const itemSchema = new mongoose.Schema({
  sku: { type: mongoose.Schema.Types.ObjectId, ref: 'ProdukSku', required: true },
  produk: { type: mongoose.Schema.Types.ObjectId, ref: 'Produk', required: true },
  uom: { type: mongoose.Schema.Types.ObjectId, ref: 'Uom', default: null }, // kemasan jual; null = satuan dasar
  price: { type: Number, required: true },                                    // per satuan / kemasan tsb
}, { _id: false });

const priceListSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true }, // mis. GROSIR
  name: { type: String, required: true, trim: true },
  deskripsi: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  items: { type: [itemSchema], default: [] },
  createdDate: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedDate: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'User' },
});

priceListSchema.index({ 'items.sku': 1 });

module.exports = mongoose.model('PriceList', priceListSchema);
