/**
 * Migrasi stok lama ke kartu stok — aman dijalankan berulang kali (idempotent).
 *   cd backend && npm run migrate:stock-opening            (gudang default: MAIN)
 *   cd backend && npm run migrate:stock-opening -- JKT-01  (kode gudang lain)
 *
 * 1. Membuat gudang default (MAIN — Main Warehouse) jika belum ada
 * 2. Untuk setiap SKU dengan stok > 0 yang BELUM punya movement/saldo:
 *    1 dokumen Stock Adjustment "Opening Balance" (POSTED) + movement OPENING + saldo gudang.
 *    ProdukSku.stok tidak berubah (sudah benar); setelah ini sum(movement) = stok.
 * Semua dalam 1 transaksi: gagal di tengah -> tidak ada yang tersimpan.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { runInTransaction } = require('../helpers/transaction');
const { nextDocNo } = require('../helpers/stockHelper');
const { round2 } = require('../helpers/number');
const audit = require('../helpers/auditLogger');
const User = require('../models/User');
require('../models/Role');
const Gudang = require('../models/Gudang');
const ProdukSku = require('../models/ProdukSku');
const StockBalance = require('../models/StockBalance');
const StockMovement = require('../models/StockMovement');
const StockAdjustment = require('../models/StockAdjustment');
const Counter = require('../models/Counter');

const GUDANG_CODE = (process.argv[2] || 'MAIN').toUpperCase();

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB\n');
  for (const M of [Gudang, StockBalance, StockMovement, StockAdjustment, Counter]) {
    await M.createCollection().catch(() => {});
  }

  // pelaku migrasi = Super Admin pertama (untuk createdBy & audit log)
  const admin = await User.findOne({ email: 'admin@mern.com' }).lean()
    || await User.findOne().populate('role').lean();
  const req = { user: admin ? { _id: admin._id, name: `${admin.name} (migration)` } : null, headers: {}, ip: null };

  const result = await runInTransaction(async () => {
    let gudang = await Gudang.findOne({ code: GUDANG_CODE });
    let gudangCreated = false;
    if (!gudang) {
      gudang = await Gudang.create({
        code: GUDANG_CODE,
        name: GUDANG_CODE === 'MAIN' ? 'Main Warehouse' : GUDANG_CODE,
        deskripsi: 'Dibuat otomatis oleh migrasi stok awal',
        createdBy: admin?._id,
      });
      await audit.logCreate(req, 'gudang', [gudang]);
      gudangCreated = true;
    }

    const candidates = await ProdukSku.find({ stok: { $gt: 0 } }).select('sku produk stok').lean();
    const ids = candidates.map((s) => s._id);
    const [moved, balanced] = await Promise.all([
      StockMovement.distinct('sku', { sku: { $in: ids } }),
      StockBalance.distinct('sku', { sku: { $in: ids } }),
    ]);
    const done = new Set([...moved, ...balanced].map(String));
    const todo = candidates.filter((s) => !done.has(String(s._id)));
    if (!todo.length) return { gudang, gudangCreated, doc: null, todo };

    const now = new Date();
    const doc = await StockAdjustment.create({
      no: await nextDocNo('ADJ', now),
      type: 'ADJUSTMENT',
      gudang: gudang._id,
      date: now,
      reason: 'OPENING',
      note: 'Saldo awal dari stok sebelum modul stok aktif (migrasi)',
      status: 'POSTED',
      lines: todo.map((s) => ({ sku: s._id, produk: s.produk, qtySystem: 0, qtyChange: round2(s.stok) })),
      postedBy: admin?._id,
      postedDate: now,
      createdBy: admin?._id,
    });

    await StockBalance.insertMany(todo.map((s) => ({
      sku: s._id, produk: s.produk, gudang: gudang._id, qty: round2(s.stok), updatedDate: now,
    })));
    await StockMovement.insertMany(todo.map((s) => ({
      sku: s._id,
      produk: s.produk,
      gudang: gudang._id,
      type: 'OPENING',
      qty: round2(s.stok),
      balanceAfter: round2(s.stok),
      refType: 'StockAdjustment',
      refId: doc._id,
      refNo: doc.no,
      reason: 'OPENING',
      note: doc.note,
      createdBy: admin?._id,
      date: now,
    })));
    // stok lama yang lebih dari 2 desimal ikut dibulatkan supaya sama dengan movement
    await ProdukSku.bulkWrite(todo.map((s) => ({
      updateOne: { filter: { _id: s._id }, update: { $set: { stok: round2(s.stok) } } },
    })));
    await audit.logCreate(req, 'stockAdjustment', [doc]);
    return { gudang, gudangCreated, doc, todo };
  });

  console.log(result.gudangCreated
    ? `[+] Gudang ${result.gudang.code} dibuat`
    : `[=] Gudang ${result.gudang.code} sudah ada`);
  if (!result.doc) {
    console.log('[=] Tidak ada SKU yang perlu dimigrasi (semua stok sudah punya kartu stok)');
  } else {
    console.log(`[+] ${result.doc.no}: saldo awal untuk ${result.todo.length} SKU`);
    result.todo.forEach((s) => console.log(`    - ${s.sku}: ${round2(s.stok)}`));
  }
  console.log('\nSelesai.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
