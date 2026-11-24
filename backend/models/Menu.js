const mongoose = require('mongoose');

const menuSchema = new mongoose.Schema({
  menu: { type: String, required: true },
  parent_id: { type: mongoose.Schema.Types.ObjectId, ref: "Menu", default: null },
  component: { type: String, default: null }, // path komponen tujuan
  img: { type: String, default: null },
  icon: { type: String, default: null },
  deskripsi: { type: String, default: null }, // tampil sebagai subjudul halaman
  // key resource di config/permissions.js. Menu tampil di sidebar hanya jika user punya izin 'view'.
  // null = tidak butuh izin (mis. Dashboard, Appearance) atau menu grup.
  resource: { type: String, default: null },
  // urutan di sidebar di antara saudaranya (kecil dulu); null = paling akhir, lalu urut nama
  order: { type: Number, default: null },

  createdDate: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedDate: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: "User" }
});

module.exports = mongoose.model('Menu', menuSchema);
