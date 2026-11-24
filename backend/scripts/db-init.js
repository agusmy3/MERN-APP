/**
 * Siapkan database (baru atau lama) dalam 1 perintah — aman dijalankan berulang kali.
 *   cd backend && npm run db:init -- --email=admin@contoh.com --password=RahasiaKuat123
 *   (argumen admin hanya dipakai bila database belum punya user; atau ADMIN_EMAIL/ADMIN_PASSWORD di .env)
 *
 * Urutan:
 * 1. Cek koneksi & replica set (wajib untuk transaksi)
 * 2. Buat koleksi & index semua model (hanya menambah, tidak menghapus index)
 * 3. seed:admin      -> Super Admin pertama (jika belum ada user)
 * 4. seed:rbac       -> role Super Admin, menu & tautan resource
 * 5. menu:organize   -> susunan & urutan menu standar (--apply)
 * 6. migrate:uom-type -> isi jenis UoM yang masih kosong dari kodenya
 * Data contoh (opsional, terpisah): npm run seed:demo
 */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const mongoose = require('mongoose');
require('../helpers/transaction');

const passArgs = process.argv.slice(2).filter((a) => a.startsWith('--email=') || a.startsWith('--password=') || a.startsWith('--name='));

const step = (title, script, args = []) => {
  console.log(`\n=== ${title} ===`);
  const res = spawnSync(process.execPath, [path.join(__dirname, script), ...args], { stdio: 'inherit', env: process.env });
  if (res.status !== 0) throw new Error(`${title} gagal (exit ${res.status})`);
};

async function main() {
  console.log('=== 1. Koneksi & replica set ===');
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI belum diisi di backend/.env');
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName) {
    throw new Error('MongoDB masih STANDALONE. Aktifkan replica set dulu: powershell -ExecutionPolicy Bypass -File .\\scripts\\setup-replica-set.ps1');
  }
  console.log(`[OK] ${mongoose.connection.name} @ replica set ${hello.setName}`);

  console.log('\n=== 2. Koleksi & index ===');
  const modelDir = path.join(__dirname, '..', 'models');
  const files = fs.readdirSync(modelDir).filter((f) => f.endsWith('.js'));
  // createIndexes hanya MENAMBAH index yang belum ada (tidak menghapus index lain seperti syncIndexes)
  let warnings = 0;
  for (const f of files) {
    const M = require(path.join(modelDir, f));
    await M.createCollection().catch(() => {});
    try {
      await M.createIndexes();
    } catch (err) {
      warnings += 1;
      console.warn(`[!] Index ${M.modelName}: ${err.message}`);
    }
  }
  console.log(`[OK] ${files.length} model${warnings ? ` (${warnings} peringatan index, mis. data duplikat)` : ''}`);
  await mongoose.disconnect();

  step('3. Super Admin pertama (seed:admin)', 'seed-admin.js', passArgs);
  step('4. Role & menu (seed:rbac)', 'seed-rbac.js');
  step('5. Susunan menu (menu:organize)', 'organize-menu.js', ['--apply']);
  step('6. Jenis UoM lama (migrate:uom-type)', 'migrate-uom-type.js');

  console.log('\nDatabase siap. Jalankan backend: npm run dev. Data contoh (opsional): npm run seed:demo');
}

main().catch(async (err) => {
  console.error(`\n[!] ${err.message}`);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => {});
});
