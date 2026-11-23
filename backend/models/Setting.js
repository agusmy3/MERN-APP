const mongoose = require('mongoose');

/**
 * Nilai System Settings: 1 dokumen per key (_id = key, mis. "tax.ppnRate").
 * Daftar key, tipe & default ada di config/settings.js.
 */
const settingSchema = new mongoose.Schema({
  _id: { type: String },
  value: { type: mongoose.Schema.Types.Mixed, default: null },
  updatedDate: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { versionKey: false, collection: 'settings' });

module.exports = mongoose.model('Setting', settingSchema);
