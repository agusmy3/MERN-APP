const mongoose = require('mongoose');

const produkSchema = new mongoose.Schema({
  name: { type: String, required: true },
  deskripsi: { type: String },
  qty: { type: Number, default: 0 },
  harga: { type: Number, default: 0 },
  kategori: { type: mongoose.Schema.Types.ObjectId, ref: 'Kategori', required: true },
  createdDate: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedDate: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "User" }
});

module.exports = mongoose.model('Produk', produkSchema);
