const mongoose = require('mongoose');

/**
 * Shift kasir POS (per kasir: tiap kasir punya laci sendiri). Maks. 1 shift OPEN per kasir.
 *   OPEN --close--> CLOSED
 * Kas seharusnya (expected) = modal awal + pembayaran TUNAI POSTED di shift ini - refund tunai
 *   + kas masuk - kas keluar (dihitung dari data, helpers/posHelper.js shiftSummary).
 * Saat tutup: closingCash (uang fisik dihitung), expectedCash & difference (closing - expected) disimpan.
 */
const cashMoveSchema = new mongoose.Schema({
  type: { type: String, required: true, enum: ['IN', 'OUT'] },
  amount: { type: Number, required: true },
  reason: { type: String, required: true },
  date: { type: Date, default: Date.now },
  by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { _id: true });

const posShiftSchema = new mongoose.Schema({
  no: { type: String, required: true, unique: true },   // SHF-202611-0001
  outlet: { type: mongoose.Schema.Types.ObjectId, ref: 'Outlet', required: true },
  gudang: { type: mongoose.Schema.Types.ObjectId, ref: 'Gudang', required: true }, // disalin dari outlet
  cashier: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, required: true, enum: ['OPEN', 'CLOSED'], default: 'OPEN' },
  openedAt: { type: Date, default: Date.now },
  openingCash: { type: Number, default: 0 },
  cashMoves: { type: [cashMoveSchema], default: [] },
  closedAt: { type: Date, default: null },
  closingCash: { type: Number, default: null },
  expectedCash: { type: Number, default: null },
  difference: { type: Number, default: null },
  closeNote: { type: String, default: '' },
  // ringkasan saat tutup (snapshot)
  salesCount: { type: Number, default: 0 },
  salesTotal: { type: Number, default: 0 },
  createdDate: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedDate: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'User' },
});

posShiftSchema.index({ cashier: 1 }, { unique: true, partialFilterExpression: { status: 'OPEN' } });
posShiftSchema.index({ outlet: 1, openedAt: -1 });
posShiftSchema.index({ status: 1, openedAt: -1 });

module.exports = mongoose.model('PosShift', posShiftSchema);
