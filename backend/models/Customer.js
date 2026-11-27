const mongoose = require('mongoose');

/**
 * Pelanggan. Satu customer bawaan `isWalkIn` ("Umum / Walk-in", kode WALKIN) untuk penjualan tanpa
 * data pembeli: dibuat oleh seed:defaults, tidak bisa dihapus / dinonaktifkan.
 */
const customerSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true }, // mis. CUST001
  name: { type: String, required: true, trim: true },
  phone: { type: String, trim: true, default: '' },
  email: { type: String, trim: true, lowercase: true, default: '' },
  address: { type: String, trim: true, default: '' },   // alamat jalan (default alamat kirim Sales Order)
  // wilayah & koordinat (validasi bersama Gudang/Outlet: helpers/locationHelper.js)
  provinsi: { type: String, trim: true, default: '' },
  kota: { type: String, trim: true, default: '' },        // kota / kabupaten
  kecamatan: { type: String, trim: true, default: '' },
  kelurahan: { type: String, trim: true, default: '' },   // kelurahan / desa
  regionCode: { type: String, default: null, index: true }, // kode wilayah terdalam yang dipilih (master regions); nama wilayah diisi dari master
  kodePos: { type: String, trim: true, default: '' },     // 5 digit
  latitude: { type: Number, default: null, min: -90, max: 90 },
  longitude: { type: Number, default: null, min: -180, max: 180 },
  npwp: { type: String, trim: true, default: '' },
  deskripsi: { type: String, default: '' },
  termDays: { type: Number, default: 0, min: 0, max: 365 }, // termin bayar default (0 = tunai) -> jatuh tempo invoice
  creditLimit: { type: Number, default: 0, min: 0 },       // batas kredit (piutang + SO belum ditagih); 0 = tanpa batas
  priceList: { type: mongoose.Schema.Types.ObjectId, ref: 'PriceList', default: null }, // harga khusus (null = harga jual default)
  isActive: { type: Boolean, default: true },
  isWalkIn: { type: Boolean, default: false },
  createdDate: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedDate: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'User' },
});

// maks. 1 customer walk-in
customerSchema.index({ isWalkIn: 1 }, { unique: true, partialFilterExpression: { isWalkIn: true } });

module.exports = mongoose.model('Customer', customerSchema);
