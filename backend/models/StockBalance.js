const mongoose = require('mongoose');

/**
 * Saldo stok per SKU per gudang (cache dari StockMovement; sumber kebenaran = movement).
 * Hanya diubah oleh helpers/stockHelper.js (applyMovements) di dalam transaksi.
 * ProdukSku.stok = total saldo semua gudang.
 */
const stockBalanceSchema = new mongoose.Schema({
  sku: { type: mongoose.Schema.Types.ObjectId, ref: 'ProdukSku', required: true },
  produk: { type: mongoose.Schema.Types.ObjectId, ref: 'Produk', required: true, index: true },
  gudang: { type: mongoose.Schema.Types.ObjectId, ref: 'Gudang', required: true, index: true },
  qty: { type: Number, default: 0, min: 0 },
  updatedDate: { type: Date, default: Date.now },
}, { versionKey: false });

stockBalanceSchema.index({ sku: 1, gudang: 1 }, { unique: true });

module.exports = mongoose.model('StockBalance', stockBalanceSchema);
