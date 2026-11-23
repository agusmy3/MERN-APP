const mongoose = require('mongoose');
const { ADJUSTMENT_TYPES, REASONS, STATUSES } = require('../config/stock');

/**
 * Dokumen penyesuaian stok (alasan KENAPA stok berubah). 1 dokumen = 1 gudang.
 *   DRAFT --post--> POSTED --cancel--> CANCELLED
 * Draft bisa diedit/dihapus tanpa mengubah stok. Post & cancel membuat StockMovement (1 transaksi).
 *
 * Baris:
 * - ADJUSTMENT : qtyChange diisi user (+/-)
 * - OPNAME     : qtyActual (hitung fisik) diisi user; qtySystem & qtyChange diisi saat post
 */
const lineSchema = new mongoose.Schema({
  sku: { type: mongoose.Schema.Types.ObjectId, ref: 'ProdukSku', required: true },
  produk: { type: mongoose.Schema.Types.ObjectId, ref: 'Produk', required: true },
  qtySystem: { type: Number, default: null },  // saldo sistem saat post
  qtyActual: { type: Number, default: null },  // OPNAME: jumlah fisik
  qtyChange: { type: Number, default: null },  // selisih yang diterapkan ke stok
  note: { type: String },
}, { _id: false });

const stockAdjustmentSchema = new mongoose.Schema({
  no: { type: String, required: true, unique: true },  // ADJ-202611-0007 / OPN-202611-0001
  type: { type: String, required: true, enum: Object.keys(ADJUSTMENT_TYPES) },
  gudang: { type: mongoose.Schema.Types.ObjectId, ref: 'Gudang', required: true },
  date: { type: Date, required: true },                // tanggal dokumen (hitung fisik / kejadian)
  reason: { type: String, required: true, enum: Object.keys(REASONS) },
  note: { type: String },
  status: { type: String, required: true, enum: STATUSES, default: 'DRAFT' },
  lines: { type: [lineSchema], default: [] },
  postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  postedDate: { type: Date, default: null },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  cancelledDate: { type: Date, default: null },
  cancelReason: { type: String, default: null },
  createdDate: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedDate: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'User' }
});

stockAdjustmentSchema.index({ status: 1, createdDate: -1 });
stockAdjustmentSchema.index({ 'lines.sku': 1 });
stockAdjustmentSchema.index({ gudang: 1 });

module.exports = mongoose.model('StockAdjustment', stockAdjustmentSchema);
