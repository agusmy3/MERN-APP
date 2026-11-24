const mongoose = require('mongoose');

/**
 * Batas stok per SKU per gudang untuk reorder alert (satuan dasar, maks. 2 desimal).
 * - minQty : reorder point — stok <= min -> perlu dipesan
 * - maxQty : target stok — saran pesan = max − (stok + sedang dipesan)
 * SKU tanpa rule di gudang tsb tidak dipantau. Hapus rule = kosongkan min & max.
 */
const reorderRuleSchema = new mongoose.Schema({
  sku: { type: mongoose.Schema.Types.ObjectId, ref: 'ProdukSku', required: true },
  produk: { type: mongoose.Schema.Types.ObjectId, ref: 'Produk', required: true, index: true },
  gudang: { type: mongoose.Schema.Types.ObjectId, ref: 'Gudang', required: true, index: true },
  minQty: { type: Number, required: true, min: 0 },
  maxQty: { type: Number, required: true, min: 0 },
  createdDate: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedDate: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'User' }
});

reorderRuleSchema.index({ sku: 1, gudang: 1 }, { unique: true });

module.exports = mongoose.model('ReorderRule', reorderRuleSchema);
