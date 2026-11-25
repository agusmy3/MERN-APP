const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  theme: { type: String, default: null }, // palet tampilan pilihan user (null = default aplikasi)
  role: { type: mongoose.Schema.Types.ObjectId, ref: 'Role', default: null }, // satu user = satu role
  isActive: { type: Boolean, default: true }, // false = tidak bisa login, sesi aktif langsung ditolak
  // akses gudang: true (default, juga user lama tanpa field) = semua gudang, termasuk gudang baru;
  // false = hanya `gudangs`. Super Admin selalu semua gudang. Lihat helpers/gudangAccess.js
  allGudang: { type: Boolean, default: true },
  // outlet POS tempat user boleh berjualan (kasir). Super Admin = semua outlet.
  outlets: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Outlet' }],
  gudangs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Gudang' }],
  // PIN persetujuan POS (void / retur di kasir) untuk user ber-izin pos:post. Hash bcrypt, tidak pernah
  // dikirim ke client (select: false); hasPosPin untuk tampilan. 5x salah -> terkunci 15 menit.
  posPinHash: { type: String, select: false },
  hasPosPin: { type: Boolean, default: false },
  posPinFailed: { type: Number, default: 0, select: false },
  posPinLockedUntil: { type: Date, default: null, select: false },
  createdDate: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedDate: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "User" }
});

// Hash password sebelum disimpan
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// Method untuk cek password
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
