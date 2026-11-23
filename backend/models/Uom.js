const mongoose = require('mongoose');

const uomSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true }, // contoh: PCS, KG, BOX
  name: { type: String, required: true, trim: true },                              // contoh: Pieces, Kilogram
  deskripsi: { type: String },
  createdDate: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedDate: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'User' }
});

module.exports = mongoose.model('Uom', uomSchema);
