const mongoose = require('mongoose');

/**
 * Kartu stok (ledger): setiap perubahan stok = 1 baris. APPEND-ONLY: tidak pernah diubah/dihapus;
 * kesalahan dikoreksi dengan movement pembalik (isReversal) dari pembatalan dokumen sumbernya.
 *
 * - qty          : bertanda, + masuk / - keluar, dalam satuan dasar produk (maks. 2 desimal)
 * - balanceAfter : saldo SKU di gudang tsb setelah movement ini
 * - ref*         : dokumen sumber (mis. StockAdjustment ADJ-202611-0007)
 * - unitCost     : harga per satuan dasar: harga beli (PURCHASE) atau HPP saat itu (lainnya)
 * - value        : qty x unitCost (bertanda)
 * - avgCostAfter : HPP rata-rata SKU setelah movement ini
 * Tidak dicatat di AuditLog: movement sendiri sudah jejak yang tidak bisa diubah.
 */
const stockMovementSchema = new mongoose.Schema({
  sku: { type: mongoose.Schema.Types.ObjectId, ref: 'ProdukSku', required: true },
  produk: { type: mongoose.Schema.Types.ObjectId, ref: 'Produk', required: true },
  gudang: { type: mongoose.Schema.Types.ObjectId, ref: 'Gudang', required: true },
  type: { type: String, required: true },     // lihat MOVEMENT_TYPES di config/stock.js
  qty: { type: Number, required: true },
  balanceAfter: { type: Number, required: true },
  refType: { type: String, default: null },   // nama model dokumen sumber
  refId: { type: mongoose.Schema.Types.ObjectId, default: null },
  refNo: { type: String, default: null },
  reason: { type: String, default: null },
  note: { type: String, default: null },
  isReversal: { type: Boolean, default: false },
  unitCost: { type: Number, default: null },
  value: { type: Number, default: null },
  avgCostAfter: { type: Number, default: null },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  date: { type: Date, default: Date.now },
}, { versionKey: false });

stockMovementSchema.index({ sku: 1, gudang: 1, date: -1, _id: -1 }); // kartu stok
stockMovementSchema.index({ produk: 1, date: -1 });
stockMovementSchema.index({ refType: 1, refId: 1 });
stockMovementSchema.index({ date: -1 });

// Append-only (sama seperti AuditLog)
const immutable = function (next) {
  next(new Error('Stock movement is immutable'));
};
stockMovementSchema.pre('save', function (next) {
  if (!this.isNew) return immutable(next);
  return next();
});
for (const op of [
  'updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
  'deleteOne', 'deleteMany', 'findOneAndDelete',
]) {
  stockMovementSchema.pre(op, immutable);
}

module.exports = mongoose.model('StockMovement', stockMovementSchema);
