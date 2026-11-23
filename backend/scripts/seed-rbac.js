/**
 * Migrasi RBAC — aman dijalankan berulang kali (idempotent).
 *   cd backend && npm run seed:rbac
 *
 * 1. Membuat role "Super Admin" (isSystem) jika belum ada
 * 2. Memberikan role tsb ke admin@mern.com
 * 3. Mengisi isActive = true untuk user lama yang belum punya field ini
 * 4. Menautkan menu yang sudah ada ke resource-nya berdasarkan route (mis. /produk -> produk)
 * 5. Membuat menu "User" (/users), "Role" (/roles) & "Audit Log" (/audit-log) jika belum ada
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const User = require('../models/User');
const Role = require('../models/Role');
const Menu = require('../models/Menu');

const SUPER_ADMIN_EMAIL = 'admin@mern.com';

// route frontend -> resource di config/permissions.js
const ROUTE_RESOURCE = {
  '/kategori': 'kategori',
  '/produk': 'produk',
  '/vendor': 'vendor',
  '/uom': 'uom',
  '/variant': 'variant',
  '/menu': 'menu',
  '/users': 'user',
  '/roles': 'role',
  '/audit-log': 'auditLog',
};

const NEW_MENUS = [
  { menu: 'User', component: '/users', icon: 'fa-solid fa-users', resource: 'user', deskripsi: 'Kelola akun pengguna dan role-nya' },
  { menu: 'Role', component: '/roles', icon: 'fa-solid fa-user-shield', resource: 'role', deskripsi: 'Atur hak akses setiap role per menu dan operasi' },
  { menu: 'Audit Log', component: '/audit-log', icon: 'fa-solid fa-clock-rotate-left', resource: 'auditLog', deskripsi: 'Jejak perubahan data dan aktivitas login' },
];

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB\n');

  // 1. Role Super Admin
  let superAdmin = await Role.findOne({ isSystem: true });
  if (superAdmin) {
    console.log(`[=] Role sistem sudah ada: "${superAdmin.name}"`);
  } else {
    superAdmin = await Role.create({
      name: 'Super Admin',
      deskripsi: 'Akses penuh ke semua menu dan operasi',
      isSystem: true,
      permissions: [],
    });
    console.log('[+] Role "Super Admin" dibuat');
  }

  // 2. admin@mern.com -> Super Admin
  const admin = await User.findOne({ email: SUPER_ADMIN_EMAIL });
  if (!admin) {
    console.error(`[!] User ${SUPER_ADMIN_EMAIL} TIDAK DITEMUKAN. Buat user tsb lalu jalankan script ini lagi.`);
  } else {
    await User.updateOne({ _id: admin._id }, { role: superAdmin._id, isActive: true });
    console.log(`[+] ${SUPER_ADMIN_EMAIL} -> role "${superAdmin.name}"`);
  }

  // 3. isActive untuk user lama
  const activated = await User.updateMany({ isActive: { $exists: false } }, { isActive: true });
  console.log(`[+] isActive diisi untuk ${activated.modifiedCount} user lama`);

  // 4. Tautkan menu lama ke resource (hanya yang belum punya resource)
  for (const [route, resource] of Object.entries(ROUTE_RESOURCE)) {
    const r = await Menu.updateMany(
      { component: route, $or: [{ resource: null }, { resource: { $exists: false } }] },
      { resource }
    );
    if (r.modifiedCount) console.log(`[+] Menu ${route} -> resource "${resource}"`);
  }

  // 5. Menu User, Role & Audit Log, diletakkan di parent yang sama dengan menu "/menu" (jika ada)
  const menuMenu = await Menu.findOne({ component: '/menu' });
  for (const item of NEW_MENUS) {
    if (await Menu.exists({ component: item.component })) {
      console.log(`[=] Menu ${item.component} sudah ada`);
      continue;
    }
    await Menu.create({
      ...item,
      parent_id: menuMenu?.parent_id ?? null,
      createdBy: admin?._id,
    });
    console.log(`[+] Menu "${item.menu}" (${item.component}) dibuat`);
  }

  // Ringkasan user tanpa role (bisa login tapi tidak punya akses ke menu mana pun)
  const noRole = await User.find({ $or: [{ role: null }, { role: { $exists: false } }] }).select('email').lean();
  if (noRole.length) {
    console.log(`\n[i] ${noRole.length} user belum punya role (atur di menu User):`);
    noRole.forEach((u) => console.log(`    - ${u.email}`));
  }

  console.log('\nSelesai.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
