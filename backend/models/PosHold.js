const mongoose = require('mongoose');

/**
 * Transaksi POS yang ditahan (hold / park): keranjang yang belum dibayar, terikat ke shift kasir.
 * Tidak mengubah stok / kas; bisa dilanjutkan (dimuat ke keranjang lalu dihapus) atau dibuang oleh
 * kasir sendiri. Maks. 10 per shift; yang tersisa dihapus saat shift ditutup. Tidak diaudit.
 */
const posHoldSchema = new mongoose.Schema({
  shift: { type: mongoose.Schema.Types.ObjectId, ref: 'PosShift', required: true },
  outlet: { type: mongoose.Schema.Types.ObjectId, ref: 'Outlet', required: true },
  cashier: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
  note: { type: String, default: '' },          // mis. "Ibu baju merah"
  lines: [{
    _id: false,
    sku: { type: mongoose.Schema.Types.ObjectId, ref: 'ProdukSku', required: true },
    qty: { type: Number, required: true },
    diskonPersen: { type: Number, default: 0 },
  }],
  discountAmount: { type: Number, default: 0 },
  createdDate: { type: Date, default: Date.now },
});

posHoldSchema.index({ shift: 1, createdDate: 1 });

module.exports = mongoose.model('PosHold', posHoldSchema);
