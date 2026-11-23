const mongoose = require('mongoose');

const permissionSchema = new mongoose.Schema({
  resource: { type: String, required: true },   // key dari config/permissions.js, mis. 'produk'
  actions: [{ type: String }],                   // subset dari ACTIONS: view, create, update, delete
}, { _id: false });

const roleSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  deskripsi: { type: String },
  // true = Super Admin: semua izin, tidak bisa diubah/dihapus lewat aplikasi
  isSystem: { type: Boolean, default: false },
  permissions: { type: [permissionSchema], default: [] },
  createdDate: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedDate: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'User' }
});

module.exports = mongoose.model('Role', roleSchema);
