const mongoose = require('mongoose');

const produkSchema = new mongoose.Schema({
  name: { type: String, required: true },
  deskripsi: { type: String },
  qty: { type: Number, default: 0 },
  harga: { type: Number, default: 0 },
  kategori: { type: mongoose.Schema.Types.ObjectId, ref: 'Kategori', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdDate: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Produk', produkSchema);
