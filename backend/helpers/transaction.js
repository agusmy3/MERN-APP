/**
 * Transaksi MongoDB (butuh replica set; dicek saat start di config/db.js).
 *
 *   const result = await runInTransaction(async () => {
 *     const doc = await Model.findById(id);                 // session otomatis (AsyncLocalStorage)
 *     if (!doc) throw new HttpError('Not found', 404);      // throw = SEMUA perubahan dibatalkan
 *     await doc.save();
 *     await audit.logUpdate(req, ...);                     // log ikut transaksi: batal bersama data
 *     return doc;
 *   });
 *   return successResponse(res, result, ...);              // response DI LUAR transaksi
 *
 * ATURAN: callback bisa dijalankan ULANG otomatis saat terjadi write conflict
 * (dua request mengubah dokumen yang sama). Di dalam callback hanya boleh operasi database:
 * - baca dokumen DI DALAM callback (jangan pakai dokumen yang dimuat di luar)
 * - jangan kirim response, panggil API luar, atau efek samping lain di dalamnya
 */
const mongoose = require('mongoose');

// Semua operasi Mongoose di dalam connection.transaction() otomatis memakai session-nya,
// jadi tidak perlu menulis { session } di setiap query. Harus diset sebelum dipakai.
mongoose.set('transactionAsyncLocalStorage', true);

/** Error bisnis dengan status HTTP; di-throw dari dalam transaksi untuk membatalkannya. */
class HttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

const runInTransaction = async (fn) => {
  let result;
  await mongoose.connection.transaction(async () => {
    result = await fn();
  });
  return result;
};

/**
 * Kunci untuk mencegah WRITE SKEW. Transaksi MongoDB (snapshot isolation) hanya bentrok jika menulis
 * dokumen yang SAMA. Aturan yang melibatkan beberapa dokumen tetap bisa dilanggar oleh 2 request
 * bersamaan, mis. "maks. 1 vendor utama per SKU", "min. 1 Super Admin aktif", atau
 * "kategori yang dihapus tidak boleh dipakai produk baru".
 *
 * Panggil lock() dengan key yang sama di SEMUA transaksi yang menyangkut aturan tsb (di dalam
 * runInTransaction, sebelum membaca data untuk pengecekan). Transaksi kedua akan bentrok,
 * diulang otomatis, dan melihat hasil transaksi pertama.
 *
 *   await lock(ref('kategori', id));                 // hapus kategori  <->  buat produk dgn kategori tsb
 *   await lock('superadmin');                        // nonaktifkan / hapus Super Admin
 */
const lock = async (...keys) => {
  const TxLock = require('../models/TxLock');
  const unique = [...new Set(keys.flat().filter(Boolean).map(String))].sort();
  for (const key of unique) {
    await TxLock.updateOne({ _id: key }, { $inc: { v: 1 } }, { upsert: true });
  }
};

/** Key kunci untuk sebuah record yang direferensikan: ref('kategori', id) -> "ref:kategori:<id>" */
const ref = (entity, id) => (id ? `ref:${entity}:${id}` : null);

module.exports = { runInTransaction, HttpError, lock, ref };
