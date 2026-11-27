const mongoose = require('mongoose');

/**
 * Master wilayah administratif Indonesia (data referensi, diisi `npm run regions:import`, tidak diedit user).
 * _id = kode Kemendagri: "32" provinsi, "32.73" kab/kota, "32.73.02" kecamatan, "32.73.02.1001" kelurahan/desa.
 * Koordinat hanya tersedia sampai kab/kota (pusat wilayah); kode pos hanya kelurahan/desa.
 * Kode yang hilang dari data terbaru tidak dihapus, tapi isActive = false (masih bisa dirujuk data lama).
 */
const regionSchema = new mongoose.Schema({
  _id: { type: String },
  level: { type: Number, required: true, min: 1, max: 4 }, // 1 provinsi, 2 kab/kota, 3 kecamatan, 4 kelurahan/desa
  name: { type: String, required: true },
  parent: { type: String, default: null },
  lat: { type: Number, default: null },
  lng: { type: Number, default: null },
  kodePos: { type: String, default: null },
  isActive: { type: Boolean, default: true },
}, { versionKey: false, collection: 'regions' });

regionSchema.index({ parent: 1, name: 1 });
regionSchema.index({ level: 1, name: 1 });

module.exports = mongoose.model('Region', regionSchema);
