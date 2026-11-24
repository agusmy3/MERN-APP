const mongoose = require('mongoose');

/**
 * Transfer stok antar gudang (2 langkah):
 *   DRAFT --send--> IN_TRANSIT --receive--> RECEIVED
 *                   IN_TRANSIT --cancel---> CANCELLED (stok kembali ke gudang asal)
 * Draft bisa diedit/dihapus tanpa mengubah stok.
 *
 * - send    : movement TRANSFER_OUT (-qty) di gudang asal; HPP saat itu disimpan di line.unitCost
 * - receive : movement TRANSFER_IN (+qtyReceived) di gudang tujuan dengan unitCost yang sama
 *             (nilai persediaan hanya berpindah). qtyReceived < qty -> selisih = hilang/rusak di
 *             perjalanan (receiveNote wajib); lebih dari qty ditolak.
 * Selama IN_TRANSIT barang tidak ada di saldo gudang mana pun: ditampilkan terpisah sebagai
 * "in transit" (valuasi, dashboard) dan dihitung sebagai stok yang akan datang di reorder tujuan.
 */
const lineSchema = new mongoose.Schema({
  sku: { type: mongoose.Schema.Types.ObjectId, ref: 'ProdukSku', required: true },
  produk: { type: mongoose.Schema.Types.ObjectId, ref: 'Produk', required: true },
  qty: { type: Number, required: true },              // dikirim (satuan dasar)
  qtyReceived: { type: Number, default: null },       // diisi saat diterima
  unitCost: { type: Number, default: null },          // HPP saat dikirim (data biaya)
  note: { type: String },
}, { _id: false });

const stockTransferSchema = new mongoose.Schema({
  no: { type: String, required: true, unique: true },  // TRF-202611-0001
  fromGudang: { type: mongoose.Schema.Types.ObjectId, ref: 'Gudang', required: true },
  toGudang: { type: mongoose.Schema.Types.ObjectId, ref: 'Gudang', required: true },
  date: { type: Date, required: true },
  note: { type: String },
  status: { type: String, required: true, enum: ['DRAFT', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED'], default: 'DRAFT' },
  lines: { type: [lineSchema], default: [] },
  sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  sentDate: { type: Date, default: null },
  receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  receivedDate: { type: Date, default: null },
  receiveNote: { type: String, default: null },        // wajib bila ada selisih
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  cancelledDate: { type: Date, default: null },
  cancelReason: { type: String, default: null },
  createdDate: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedDate: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'User' },
});

stockTransferSchema.index({ status: 1, createdDate: -1 });
stockTransferSchema.index({ fromGudang: 1 });
stockTransferSchema.index({ toGudang: 1, status: 1 });
stockTransferSchema.index({ 'lines.sku': 1 });

module.exports = mongoose.model('StockTransfer', stockTransferSchema);
