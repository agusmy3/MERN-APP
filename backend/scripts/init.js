/**
 * INIT — data awal aplikasi baru. MENGHAPUS SELURUH DATABASE lalu membuat:
 *   1. koleksi & index semua model
 *   2. System Settings (PKP, tarif PPN, harga jual termasuk PPN)
 *   3. semua menu (susunan standar config/menus.js)
 *   4. role Super Admin + role standar dengan izinnya (config/roles.js)
 *   5. 1 user Super Admin
 *   6. customer "Umum / Walk-in" (default penjualan & POS)
 *   7. master wilayah Indonesia (koleksi regions, sama dengan `npm run regions:import`)
 *
 *   cd backend && npm run init -- --wipe --email=admin@contoh.com --password=RahasiaKuat123 [--name="Administrator"]
 *     [--pkp=true|false] [--ppn=11] [--price-includes-tax=true|false]
 *   email / password / name juga bisa dari ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME di .env.
 *
 * Pengaman: wajib --wipe; jika NODE_ENV=production wajib juga --force. Nama database & server
 * ditampilkan sebelum dihapus. Backup dulu jika perlu (mongodump). Data contoh: npm run demo.
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const mongoose = require('mongoose');
const { runInTransaction } = require('../helpers/transaction');
const audit = require('../helpers/auditLogger');
const { normalizeSetting } = require('../helpers/settings');
const { normalizePermissions } = require('../config/permissions');
const { ROLE_TEMPLATES, toPermissionList } = require('../config/roles');
const { MENU_TARGET } = require('../config/menus');

const has = (flag) => process.argv.includes(`--${flag}`);
const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
const bool = (v) => (v === undefined ? undefined : !['false', '0', 'no'].includes(String(v).toLowerCase()));
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function main() {
  // ---------- validasi sebelum menyentuh database ----------
  const email = String(arg('email') || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(arg('password') || process.env.ADMIN_PASSWORD || '');
  const name = String(arg('name') || process.env.ADMIN_NAME || 'Administrator').trim();
  if (!EMAIL_RX.test(email)) throw new Error('Email Super Admin tidak valid. Pakai --email=<email> (atau ADMIN_EMAIL di .env)');
  if (password.length < 8) throw new Error('Password Super Admin minimal 8 karakter. Pakai --password=<password> (atau ADMIN_PASSWORD di .env)');
  const settings = {};
  const put = (key, value) => { if (value !== undefined) settings[key] = normalizeSetting(key, value); };
  put('tax.isPKP', bool(arg('pkp')));
  put('tax.ppnRate', arg('ppn') === undefined ? undefined : Number(arg('ppn')));
  put('sales.priceIncludesTax', bool(arg('price-includes-tax')));

  if (!has('wipe')) {
    throw new Error('Script ini MENGHAPUS SEMUA DATA di database. Tambahkan --wipe untuk melanjutkan.');
  }
  if (process.env.NODE_ENV === 'production' && !has('force')) {
    throw new Error('NODE_ENV=production: menghapus database produksi ditolak. Tambahkan --force jika memang disengaja.');
  }
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI belum diisi di backend/.env');

  // ---------- koneksi & replica set ----------
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  if (!hello.setName) {
    throw new Error('MongoDB masih STANDALONE. Aktifkan replica set dulu: powershell -ExecutionPolicy Bypass -File .\\scripts\\setup-replica-set.ps1');
  }
  const dbName = mongoose.connection.name;
  console.log(`Database : ${dbName}`);
  console.log(`Server   : ${mongoose.connection.host}:${mongoose.connection.port} (replica set ${hello.setName})`);
  console.log(`NODE_ENV : ${process.env.NODE_ENV || '(kosong)'}`);

  // ---------- kosongkan ----------
  console.log(`\n=== 1. Menghapus database "${dbName}" ===`);
  await mongoose.connection.db.dropDatabase();
  console.log('[OK] database dikosongkan');

  console.log('\n=== 2. Koleksi & index ===');
  const modelDir = path.join(__dirname, '..', 'models');
  const files = fs.readdirSync(modelDir).filter((f) => f.endsWith('.js'));
  for (const f of files) {
    const M = require(path.join(modelDir, f));
    await M.createCollection().catch(() => {});
    await M.createIndexes();
  }
  console.log(`[OK] ${files.length} model`);

  const Setting = require('../models/Setting');
  const Role = require('../models/Role');
  const User = require('../models/User');
  const Menu = require('../models/Menu');
  const { ensureWalkInCustomer } = require('../controllers/customerController');

  console.log('\n=== 3. Settings, menu, role, Super Admin, customer walk-in ===');
  const result = await runInTransaction(async () => {
    const superRole = await Role.create({ name: 'Super Admin', deskripsi: 'Akses penuh ke semua menu dan operasi', isSystem: true, permissions: [] });
    const admin = await User.create({ name, email, password, role: superRole._id, isActive: true });
    const req = { user: { _id: admin._id, name: `${admin.name} (init)` }, headers: {}, ip: null };
    const by = { createdBy: admin._id };
    const batchId = audit.newBatchId();
    const log = (entity, docs) => audit.logCreate(req, entity, docs, { batchId });

    // settings (yang tidak diisi = default registri)
    if (Object.keys(settings).length) {
      const before = await audit.snap('setting', Object.keys(settings).map((key) => ({ _id: key, value: undefined })));
      for (const [key, value] of Object.entries(settings)) {
        await Setting.create({ _id: key, value, updatedDate: new Date(), updatedBy: admin._id });
      }
      await audit.logUpdate(req, 'setting', before, await Setting.find().lean(), { batchId });
    }

    // menu
    const menus = [];
    for (const item of MENU_TARGET) {
      if (!item.group) {
        menus.push(await Menu.create({ menu: item.menu, component: item.component, icon: item.icon, resource: item.resource, deskripsi: item.deskripsi, order: item.order, ...by }));
        continue;
      }
      const group = await Menu.create({ menu: item.group, icon: item.icon, order: item.order, ...by });
      menus.push(group);
      for (const [i, child] of item.children.entries()) {
        menus.push(await Menu.create({ ...child, parent_id: group._id, order: i + 1, ...by }));
      }
    }

    // role standar
    const roles = [superRole];
    for (const t of ROLE_TEMPLATES) {
      roles.push(await Role.create({ name: t.name, deskripsi: t.deskripsi, permissions: normalizePermissions(toPermissionList(t.permissions)), ...by }));
    }

    const { customer } = await ensureWalkInCustomer(admin._id);

    await log('menu', menus);
    await log('role', roles);
    await log('user', [admin]);
    await log('customer', [customer]);
    return { admin, menus: menus.length, roles: roles.map((r) => r.name), customer };
  });

  console.log(`[OK] ${result.menus} menu`);
  console.log(`[OK] ${result.roles.length} role: ${result.roles.join(', ')}`);
  console.log(`[OK] Super Admin: ${result.admin.email}`);
  console.log(`[OK] Customer walk-in: ${result.customer.code} — ${result.customer.name}`);
  if (Object.keys(settings).length) console.log(`[OK] Settings: ${JSON.stringify(settings)}`);

  console.log('\n=== 4. Master wilayah ===');
  const regions = await require('../helpers/regionHelper').importRegions();
  console.log(`[OK] ${regions.total} wilayah (provinsi s/d kelurahan/desa)`);
  console.log('\nSelesai. Jalankan backend (npm run dev) lalu login. Data contoh (opsional): npm run demo -- --password=<password user demo>');
}

main()
  .catch((err) => {
    console.error(`\n[!] ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
