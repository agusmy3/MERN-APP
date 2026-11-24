const mongoose = require('mongoose');

/**
 * Revaluasi HPP: mengisi / mengoreksi HPP rata-rata (ProdukSku.avgCost) TANPA mengubah jumlah stok,
 * mis. stok lama yang belum punya HPP atau HPP yang salah input.
 *   DRAFT --post--> POSTED --cancel--> CANCELLED
 * Post: HPP baru diterapkan + movement REVALUATION (qty 0, value = stok x selisih HPP) per gudang.
 * Cancel: HPP dikembalikan, hanya jika HPP SKU belum berubah lagi sejak revaluasi.
 */
const lineSchema = new mongoose.Schema({
  sku: { type: mongoose.Schema.Types.ObjectId, ref: 'ProdukSku', required: true },
  produk: { type: mongoose.Schema.Types.ObjectId, ref: 'Produk', required: true },
  newCost: { type: Number, required: true },      // HPP baru per satuan dasar
  oldCost: { type: Number, default: null },        // HPP saat post (null = belum ada)
  qty: { type: Number, default: null },            // total stok saat post
  valueChange: { type: Number, default: null },    // qty x (newCost - oldCost)
  note: { type: String },
}, { _id: false });

const costRevaluationSchema = new mongoose.Schema({
  no: { type: String, required: true, unique: true },  // REV-202611-0001
  date: { type: Date, required: true },
  note: { type: String, required: true },              // alasan revaluasi (wajib)
  status: { type: String, required: true, enum: ['DRAFT', 'POSTED', 'CANCELLED'], default: 'DRAFT' },
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

costRevaluationSchema.index({ status: 1, createdDate: -1 });
costRevaluationSchema.index({ 'lines.sku': 1 });

module.exports = mongoose.model('CostRevaluation', costRevaluationSchema);
