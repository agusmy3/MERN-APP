const mongoose = require('mongoose');

const kategoriSchema = new mongoose.Schema({
  name: { type: String, required: true },
  deskripsi: { type: String },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdDate: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Kategori', kategoriSchema);
