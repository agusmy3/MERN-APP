const mongoose = require('mongoose');

const variantSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true }, // contoh: COLOR, SIZE
  name: { type: String, required: true, trim: true },                              // contoh: Warna, Ukuran
  values: {                                                                        // contoh: [Merah, Biru] / [S, M, L]
    type: [{ type: String, trim: true }],
    validate: {
      validator: (arr) => Array.isArray(arr) && arr.length > 0,
      message: 'Variant must have at least one value'
    }
  },
  deskripsi: { type: String },
  createdDate: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedDate: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'User' }
});

module.exports = mongoose.model('Variant', variantSchema);
