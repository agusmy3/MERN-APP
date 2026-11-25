const mongoose = require('mongoose');

/**
 * Outlet / toko untuk POS. Stok outlet diambil dari 1 gudang (`gudang`); 1 gudang boleh melayani
 * beberapa outlet. Kasir ditugaskan lewat User.outlets. Outlet nonaktif tidak bisa membuka shift baru.
 * Outlet yang sudah punya shift / transaksi tidak bisa dihapus, hanya dinonaktifkan.
 */
const outletSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true }, // mis. TOKO-01
  name: { type: String, required: true, trim: true },
  gudang: { type: mongoose.Schema.Types.ObjectId, ref: 'Gudang', required: true },
  phone: { type: String, trim: true, default: '' },
  alamat: { type: String },
  // wilayah (teks bebas, sama dengan Gudang)
  provinsi: { type: String, trim: true },
  kota: { type: String, trim: true },        // kota / kabupaten
  kecamatan: { type: String, trim: true },
  kodePos: { type: String, trim: true },     // 5 digit
  latitude: { type: Number, default: null, min: -90, max: 90 },
  longitude: { type: Number, default: null, min: -180, max: 180 },
  // POS
  priceIncludesTax: { type: Boolean, default: true },        // harga jual di outlet sudah termasuk PPN
  receiptHeader: { type: String, default: '' },               // teks di atas struk (mis. nama usaha, NPWP)
  receiptFooter: { type: String, default: '' },               // mis. "Terima kasih"
  receiptWidth: { type: Number, enum: [58, 80], default: 58 }, // lebar kertas struk (mm)
  autoPrint: { type: Boolean, default: false },               // cetak struk otomatis setelah bayar
  deskripsi: { type: String },
  isActive: { type: Boolean, default: true },
  createdDate: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedDate: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'User' },
});

outletSchema.index({ gudang: 1 });

module.exports = mongoose.model('Outlet', outletSchema);
