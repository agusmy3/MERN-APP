const mongoose = require('mongoose');

/**
 * Penomoran dokumen: _id = prefix periode (mis. "ADJ-202611"), seq = nomor terakhir.
 * Dinaikkan di dalam transaksi (helpers/stockHelper.js nextDocNo), jadi ikut batal bila transaksi batal.
 */
const counterSchema = new mongoose.Schema({
  _id: { type: String },
  seq: { type: Number, default: 0 },
}, { versionKey: false, collection: 'counters' });

module.exports = mongoose.model('Counter', counterSchema);
