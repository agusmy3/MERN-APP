/**
 * Satu-satunya jalan untuk mengubah stok. Dipanggil DI DALAM runInTransaction.
 *
 *   await applyMovements(req, [
 *     { sku, gudang, qty: -5, type: 'ADJUSTMENT', reason: 'DAMAGED', note },
 *   ], { refType: 'StockAdjustment', refId: doc._id, refNo: doc.no });
 *
 * Untuk setiap baris: saldo gudang (StockBalance) & total SKU (ProdukSku.stok) diperbarui dan
 * 1 StockMovement dibuat. Saldo tidak boleh minus -> HttpError (seluruh transaksi batal).
 *
 * Konkurensi: saldo dibaca lalu ditulis di transaksi yang sama. Dua transaksi yang mengubah saldo
 * SKU/gudang yang sama pasti menulis dokumen yang sama -> bentrok -> salah satu diulang otomatis
 * dan membaca saldo terbaru (tidak ada stok yang "hilang" karena tumpang-tindih).
 */
const mongoose = require('mongoose');
const ProdukSku = require('../models/ProdukSku');
const StockBalance = require('../models/StockBalance');
const StockMovement = require('../models/StockMovement');
const Counter = require('../models/Counter');
const StockAdjustment = require('../models/StockAdjustment');
const { HttpError } = require('./transaction');
const { round2 } = require('./number');

const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

/** Saldo per SKU di 1 gudang: Map skuId -> qty (SKU tanpa saldo = 0) */
const getBalances = async (gudang, skuIds) => {
  const rows = await StockBalance.find({ gudang, sku: { $in: skuIds } }).select('sku qty').lean();
  return new Map(rows.map((r) => [String(r.sku), r.qty]));
};

const applyMovements = async (req, entries, { refType = null, refId = null, refNo = null, isReversal = false } = {}) => {
  const now = new Date();
  const movements = [];

  // gabungkan baris SKU+gudang yang sama supaya saldo dihitung sekali
  const grouped = new Map();
  for (const e of entries) {
    const qty = round2(e.qty);
    if (!qty) continue;
    const key = `${e.sku}:${e.gudang}`;
    if (grouped.has(key)) grouped.get(key).qty = round2(grouped.get(key).qty + qty);
    else grouped.set(key, { ...e, qty });
  }

  // urutan tetap (mengurangi bentrok berulang antar transaksi)
  const list = [...grouped.values()].filter((e) => e.qty).sort((a, b) => String(a.sku).localeCompare(String(b.sku)));
  if (!list.length) return [];

  const skus = await ProdukSku.find({ _id: { $in: list.map((e) => e.sku) } }).select('sku produk stok').lean();
  const skuMap = new Map(skus.map((s) => [String(s._id), s]));
  const totals = new Map(skus.map((s) => [String(s._id), s.stok || 0]));

  for (const e of list) {
    const sku = skuMap.get(String(e.sku));
    if (!sku) throw new HttpError('One or more SKUs no longer exist', 400);

    const balance = await StockBalance.findOne({ sku: sku._id, gudang: e.gudang }).select('qty').lean();
    const current = balance?.qty || 0;
    const next = round2(current + e.qty);
    if (next < 0) {
      throw new HttpError(`${sku.sku}: stock is ${fmt(current)}, cannot be reduced by ${fmt(-e.qty)}`, 400);
    }

    await StockBalance.updateOne(
      { sku: sku._id, gudang: e.gudang },
      { $set: { qty: next, produk: sku.produk, updatedDate: now } },
      { upsert: true }
    );
    totals.set(String(sku._id), round2(totals.get(String(sku._id)) + e.qty));

    movements.push({
      sku: sku._id,
      produk: sku.produk,
      gudang: e.gudang,
      type: e.type,
      qty: e.qty,
      balanceAfter: next,
      refType,
      refId,
      refNo,
      reason: e.reason || null,
      note: e.note || null,
      isReversal,
      createdBy: req.user?._id ?? null,
      date: now,
    });
  }

  // total semua gudang (cache di SKU); bulkWrite tidak memicu audit -> memang disengaja
  await ProdukSku.bulkWrite([...totals.entries()].map(([id, stok]) => ({
    updateOne: { filter: { _id: id }, update: { $set: { stok: Math.max(stok, 0) } } },
  })));

  return StockMovement.insertMany(movements);
};

/**
 * Nomor dokumen berikutnya per bulan: nextDocNo('ADJ') -> "ADJ-202611-0007".
 * Counter dinaikkan di dalam transaksi -> transaksi yang batal tidak menghabiskan nomor.
 */
const nextDocNo = async (prefix, date = new Date()) => {
  const period = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
  const key = `${prefix}-${period}`;
  const counter = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  ).lean();
  return `${key}-${String(counter.seq).padStart(4, '0')}`;
};

/** SKU yang sudah punya histori stok (movement) atau dipakai dokumen stok -> tidak boleh dihapus */
const skusWithStockHistory = async (skuIds) => {
  const ids = skuIds.map((id) => new mongoose.Types.ObjectId(String(id)));
  const [moved, inDocs] = await Promise.all([
    StockMovement.distinct('sku', { sku: { $in: ids } }),
    StockAdjustment.distinct('lines.sku', { 'lines.sku': { $in: ids } }),
  ]);
  return new Set([...moved, ...inDocs].map(String).filter((id) => ids.some((x) => String(x) === id)));
};

module.exports = { applyMovements, getBalances, nextDocNo, skusWithStockHistory };
