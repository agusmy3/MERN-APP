/**
 * Import / perbarui master wilayah (koleksi `regions`) dari backend/data/regions.json.gz — idempotent.
 *   cd backend && npm run regions:import
 *
 * Kode baru ditambah, yang berubah diperbarui, yang hilang dari data dinonaktifkan (tidak dihapus).
 * Dijalankan otomatis oleh `npm run init`. Database lama: jalankan sekali (dan setiap file data diperbarui).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const mongoose = require('mongoose');
const { importRegions, readRegionFile } = require('../helpers/regionHelper');

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI belum diisi di backend/.env');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  const { source, generated } = readRegionFile();
  console.log(`Sumber : ${source} (${generated})`);
  const started = Date.now();
  const r = await importRegions();
  console.log(`[OK] ${r.total} wilayah: +${r.added} baru, ${r.updated} diperbarui, ${r.retired} dinonaktifkan (${((Date.now() - started) / 1000).toFixed(1)} dtk)`);
}

main()
  .catch((err) => {
    console.error(`[!] ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
