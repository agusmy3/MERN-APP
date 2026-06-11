const mongoose = require('mongoose');

const kategoriSchema = new mongoose.Schema({
  name: { type: String, required: true },
  deskripsi: { type: String },
  createdDate: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedDate: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "User" }
});

module.exports = mongoose.model('Kategori', kategoriSchema);
