const mongoose = require('mongoose');

/**
 * Gudang / lokasi stok. Stok disimpan per SKU + gudang (StockBalance).
 * Gudang yang sudah punya histori stok tidak bisa dihapus, hanya dinonaktifkan
 * (gudang nonaktif tidak bisa dipilih untuk dokumen baru).
 */
const gudangSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true }, // mis. MAIN, JKT-01
  name: { type: String, required: true, trim: true },
  alamat: { type: String },
  // wilayah: dipilih dari master regions (regionCode), nama disalin; data lama tanpa kode = teks bebas
  provinsi: { type: String, trim: true },
  kota: { type: String, trim: true },        // kota / kabupaten
  kecamatan: { type: String, trim: true },
  kelurahan: { type: String, trim: true },   // kelurahan / desa
  regionCode: { type: String, default: null, index: true }, // kode wilayah terdalam yang dipilih (master regions)
  kodePos: { type: String, trim: true },     // 5 digit
  // koordinat (WGS84, derajat desimal); keduanya terisi atau keduanya null
  latitude: { type: Number, default: null, min: -90, max: 90 },
  longitude: { type: Number, default: null, min: -180, max: 180 },
  deskripsi: { type: String },
  isActive: { type: Boolean, default: true },
  createdDate: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedDate: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'User' }
});

module.exports = mongoose.model('Gudang', gudangSchema);
