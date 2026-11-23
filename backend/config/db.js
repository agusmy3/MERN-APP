const mongoose = require('mongoose');
// mengaktifkan session otomatis untuk transaksi (harus dimuat sebelum query pertama)
require('../helpers/transaction');

/**
 * Koneksi MongoDB. Backend WAJIB terhubung ke replica set karena semua endpoint tulis
 * memakai transaksi; standalone -> server berhenti dengan pesan cara mengaktifkannya.
 */
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    if (!hello.setName) {
      console.error([
        '',
        '[!] MongoDB berjalan sebagai STANDALONE, padahal backend butuh replica set (untuk transaksi).',
        '    Aktifkan sekali saja (PowerShell "Run as Administrator", dari folder backend):',
        '      powershell -ExecutionPolicy Bypass -File .\\scripts\\setup-replica-set.ps1',
        '    Lalu pastikan MONGO_URI memakai ?replicaSet=rs0',
        '',
      ].join('\n'));
      process.exit(1);
    }

    // koleksi dibuat di luar transaksi (pembuatan koleksi bersamaan di dalam transaksi bisa bentrok)
    for (const name of ['TxLock', 'Counter', 'Gudang', 'StockBalance', 'StockMovement', 'StockAdjustment']) {
      await require(`../models/${name}`).createCollection().catch(() => {});
    }

    console.log(`MongoDB connected (replica set: ${hello.setName})`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

module.exports = connectDB;
