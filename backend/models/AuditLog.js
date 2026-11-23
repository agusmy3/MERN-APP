const mongoose = require('mongoose');

/**
 * Jejak perubahan data (append-only): siapa mengubah apa, kapan, dari nilai berapa ke berapa.
 * Ditulis lewat helpers/auditLogger.js, TIDAK PERNAH diubah/dihapus (dicegah oleh hook di bawah).
 *
 * - entity     : key resource/entitas (produk, produkSku, vendorPrice, role, user, auth)
 * - parent     : induk untuk histori gabungan (SKU & harga vendor -> produk)
 * - changes    : hanya field yang berubah; relasi disimpan { id, text }; field rahasia hanya { changed: true }
 * - snapshot   : dokumen lengkap saat delete (data mentah, tanpa password)
 * - batchId    : mengelompokkan banyak log dari 1 aksi (bulk edit, hapus berantai, ...)
 * - userName   : disalin agar tetap terbaca walau user dihapus
 */
const changeSchema = new mongoose.Schema({
  field: { type: String, required: true },
  label: { type: String },
  format: { type: String },  // petunjuk tampilan: money | bool | number | text | secret
  from: { type: mongoose.Schema.Types.Mixed, default: null },
  to: { type: mongoose.Schema.Types.Mixed, default: null },
}, { _id: false });

const auditLogSchema = new mongoose.Schema({
  entity: { type: String, required: true },
  entityId: { type: mongoose.Schema.Types.ObjectId, default: null },
  entityLabel: { type: String },
  parent: {
    entity: { type: String },
    id: { type: mongoose.Schema.Types.ObjectId },
  },
  action: { type: String, required: true, enum: ['create', 'update', 'delete', 'login', 'login_failed'] },
  changes: { type: [changeSchema], default: [] },
  snapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  meta: { type: mongoose.Schema.Types.Mixed, default: null },  // mis. alasan login gagal, user agent
  batchId: { type: String, default: null },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  userName: { type: String },
  ip: { type: String },
  date: { type: Date, default: Date.now },
}, { versionKey: false });

auditLogSchema.index({ entity: 1, entityId: 1, date: -1 });  // histori 1 record
auditLogSchema.index({ 'parent.id': 1, date: -1 });          // histori gabungan produk
auditLogSchema.index({ user: 1, date: -1 });                 // aktivitas per user
auditLogSchema.index({ date: -1 });                          // halaman Audit Log global

// Append-only: tolak semua operasi ubah/hapus
const immutable = function (next) {
  next(new Error('Audit log is immutable'));
};
auditLogSchema.pre('save', function (next) {
  if (!this.isNew) return immutable(next);
  return next();
});
for (const op of [
  'updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
  'deleteOne', 'deleteMany', 'findOneAndDelete',
]) {
  auditLogSchema.pre(op, immutable);
}

module.exports = mongoose.model('AuditLog', auditLogSchema);
