const mongoose = require('mongoose');

/**
 * Dokumen kunci untuk transaksi (lihat lock() di helpers/transaction.js).
 * Isinya tidak penting; yang penting dua transaksi yang menulis _id yang sama pasti bentrok,
 * sehingga salah satu diulang dan melihat hasil transaksi lainnya (mencegah write skew).
 */
const txLockSchema = new mongoose.Schema({
  _id: { type: String },
  v: { type: Number, default: 0 },
}, { versionKey: false, collection: 'txlocks' });

module.exports = mongoose.model('TxLock', txLockSchema);
