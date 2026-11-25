/**
 * Migrasi RBAC — aman dijalankan berulang kali (idempotent).
 *   cd backend && npm run seed:rbac
 *
 * 1. Membuat role "Super Admin" (isSystem) jika belum ada
 * 2. Memberikan role tsb ke admin@mern.com (instalasi lama); database baru: buat admin dengan npm run seed:admin
 * 3. Mengisi isActive = true untuk user lama yang belum punya field ini
 * 4. Menautkan menu yang sudah ada ke resource-nya berdasarkan route (mis. /produk -> produk)
 * 5. Membuat menu "User" (/users), "Role" (/roles) & "Audit Log" (/audit-log) jika belum ada
 * 6. Membuat menu "Warehouse" (/gudang, di grup yang sama dengan /uom) dan grup "Inventory"
 *    berisi "Stock Adjustment", "Stock Movement" & "Stock Valuation" (/stock-valuation)
 * 7. Grup "Purchasing" (Purchase Order, Goods Receipt) & menu "System Settings" (/settings)
 * 8. Grup "Sales" (Sales Invoice) & menu "Customer" (/customer, di grup yang sama dengan /vendor)
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
  '/gudang': 'gudang',
  '/stock-adjustment': 'stockAdjustment',
  '/stock-transfer': 'stockTransfer',
  '/stock-movement': 'stockMovement',
  '/stock-valuation': 'vendorPrice',
  '/cost-revaluation': 'costRevaluation',
  '/reorder': 'reorder',
  '/purchase-order': 'purchaseOrder',
  '/goods-receipt': 'goodsReceipt',
  '/settings': 'setting',
  '/customer': 'customer',
  '/sales-invoice': 'salesInvoice',
  '/sales-return': 'salesReturn',
  '/sales-payment': 'salesPayment',
  '/price-list': 'priceList',
  '/sales-report': 'salesReport',
  '/outlet': 'outlet',
  '/pos': 'pos',
  '/pos-shift': 'posShift',
};

const POS_MENUS = [
  { menu: 'Cashier', component: '/pos', icon: 'fa-solid fa-cash-register', resource: 'pos', deskripsi: 'Layar kasir: scan barang, bayar, cetak struk' },
  { menu: 'POS Shift', component: '/pos-shift', icon: 'fa-solid fa-clock', resource: 'posShift', deskripsi: 'Shift kasir: modal, penjualan, kas & selisih' },
];

const SALES_MENUS = [
  { menu: 'Sales Invoice', component: '/sales-invoice', icon: 'fa-solid fa-file-invoice-dollar', resource: 'salesInvoice', deskripsi: 'Penjualan langsung: stok keluar & laba kotor saat diposting' },
  { menu: 'Sales Return', component: '/sales-return', icon: 'fa-solid fa-rotate-left', resource: 'salesReturn', deskripsi: 'Retur atas invoice: stok masuk kembali, tagihan berkurang' },
  { menu: 'Sales Payment', component: '/sales-payment', icon: 'fa-solid fa-money-bill-wave', resource: 'salesPayment', deskripsi: 'Pembayaran & refund invoice penjualan' },
  { menu: 'Price List', component: '/price-list', icon: 'fa-solid fa-tags', resource: 'priceList', deskripsi: 'Harga jual khusus per customer' },
  { menu: 'Sales Report', component: '/sales-report', icon: 'fa-solid fa-chart-column', resource: 'salesReport', deskripsi: 'Penjualan bersih per periode, customer & produk; umur piutang' },
];

const PURCHASING_MENUS = [
  { menu: 'Purchase Order', component: '/purchase-order', icon: 'fa-solid fa-file-invoice', resource: 'purchaseOrder', deskripsi: 'Pesanan pembelian ke vendor' },
  { menu: 'Goods Receipt', component: '/goods-receipt', icon: 'fa-solid fa-truck-ramp-box', resource: 'goodsReceipt', deskripsi: 'Penerimaan barang dari PO: stok & HPP bertambah saat diposting' },
];

const INVENTORY_MENUS = [
  { menu: 'Stock Adjustment', component: '/stock-adjustment', icon: 'fa-solid fa-boxes-stacked', resource: 'stockAdjustment', deskripsi: 'Penyesuaian stok & stock opname (draft, posting, pembatalan)' },
  { menu: 'Stock Transfer', component: '/stock-transfer', icon: 'fa-solid fa-truck-arrow-right', resource: 'stockTransfer', deskripsi: 'Pindah stok antar gudang: kirim lalu terima' },
  { menu: 'Stock Valuation', component: '/stock-valuation', icon: 'fa-solid fa-sack-dollar', resource: 'vendorPrice', deskripsi: 'Nilai persediaan saat ini: stok x HPP rata-rata' },
  { menu: 'Reorder', component: '/reorder', icon: 'fa-solid fa-bell', resource: 'reorder', deskripsi: 'SKU yang perlu dipesan ulang (stok <= minimum) & buat draft PO' },
  { menu: 'Cost Revaluation', component: '/cost-revaluation', icon: 'fa-solid fa-scale-balanced', resource: 'costRevaluation', deskripsi: 'Isi / koreksi HPP SKU tanpa mengubah jumlah stok' },
  { menu: 'Stock Movement', component: '/stock-movement', icon: 'fa-solid fa-right-left', resource: 'stockMovement', deskripsi: 'Kartu stok: semua pergerakan stok per SKU dan gudang' },
];

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

  // 2. admin@mern.com (instalasi lama) -> Super Admin; selain itu pakai Super Admin yang sudah ada
  let admin = await User.findOne({ email: SUPER_ADMIN_EMAIL });
  if (admin) {
    await User.updateOne({ _id: admin._id }, { role: superAdmin._id, isActive: true });
    console.log(`[+] ${SUPER_ADMIN_EMAIL} -> role "${superAdmin.name}"`);
  } else {
    admin = await User.findOne({ role: superAdmin._id, isActive: { $ne: false } }).sort({ createdDate: 1 });
    if (admin) console.log(`[=] Super Admin: ${admin.email}`);
    else console.error('[!] Belum ada user Super Admin. Jalankan: npm run seed:admin -- --email=<email> --password=<password>');
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

  // 6. Warehouse (di grup yang sama dengan UoM) + grup Inventory
  if (await Menu.exists({ component: '/gudang' })) {
    console.log('[=] Menu /gudang sudah ada');
  } else {
    const uomMenu = await Menu.findOne({ component: '/uom' });
    await Menu.create({
      menu: 'Warehouse',
      component: '/gudang',
      icon: 'fa-solid fa-warehouse',
      resource: 'gudang',
      deskripsi: 'Kelola gudang / lokasi penyimpanan stok',
      parent_id: uomMenu?.parent_id ?? null,
      createdBy: admin?._id,
    });
    console.log('[+] Menu "Warehouse" (/gudang) dibuat');
  }

  let inventory = await Menu.findOne({ menu: 'Inventory', component: null });
  for (const item of INVENTORY_MENUS) {
    if (await Menu.exists({ component: item.component })) {
      console.log(`[=] Menu ${item.component} sudah ada`);
      continue;
    }
    if (!inventory) {
      inventory = await Menu.create({ menu: 'Inventory', icon: 'fa-solid fa-boxes-stacked', createdBy: admin?._id });
      console.log('[+] Menu grup "Inventory" dibuat');
    }
    await Menu.create({ ...item, parent_id: inventory._id, createdBy: admin?._id });
    console.log(`[+] Menu "${item.menu}" (${item.component}) dibuat`);
  }

  // 7. Purchasing + System Settings
  let purchasing = await Menu.findOne({ menu: 'Purchasing', component: null });
  for (const item of PURCHASING_MENUS) {
    if (await Menu.exists({ component: item.component })) {
      console.log(`[=] Menu ${item.component} sudah ada`);
      continue;
    }
    if (!purchasing) {
      purchasing = await Menu.create({ menu: 'Purchasing', icon: 'fa-solid fa-cart-shopping', createdBy: admin?._id });
      console.log('[+] Menu grup "Purchasing" dibuat');
    }
    await Menu.create({ ...item, parent_id: purchasing._id, createdBy: admin?._id });
    console.log(`[+] Menu "${item.menu}" (${item.component}) dibuat`);
  }
  if (await Menu.exists({ component: '/settings' })) {
    console.log('[=] Menu /settings sudah ada');
  } else {
    const menuMenu2 = await Menu.findOne({ component: '/menu' });
    await Menu.create({
      menu: 'System Settings',
      component: '/settings',
      icon: 'fa-solid fa-sliders',
      resource: 'setting',
      deskripsi: 'Variabel global aplikasi, mis. status PKP & tarif PPN',
      parent_id: menuMenu2?.parent_id ?? null,
      createdBy: admin?._id,
    });
    console.log('[+] Menu "System Settings" (/settings) dibuat');
  }

  // 8. Sales + Customer
  let sales = await Menu.findOne({ menu: 'Sales', component: null });
  for (const item of SALES_MENUS) {
    if (await Menu.exists({ component: item.component })) {
      console.log(`[=] Menu ${item.component} sudah ada`);
      continue;
    }
    if (!sales) {
      sales = await Menu.create({ menu: 'Sales', icon: 'fa-solid fa-cash-register', createdBy: admin?._id });
      console.log('[+] Menu grup "Sales" dibuat');
    }
    await Menu.create({ ...item, parent_id: sales._id, createdBy: admin?._id });
    console.log(`[+] Menu "${item.menu}" (${item.component}) dibuat`);
  }
  if (await Menu.exists({ component: '/customer' })) {
    console.log('[=] Menu /customer sudah ada');
  } else {
    const vendorMenu = await Menu.findOne({ component: '/vendor' });
    await Menu.create({
      menu: 'Customer',
      component: '/customer',
      icon: 'fa-solid fa-user-tag',
      resource: 'customer',
      deskripsi: 'Data pelanggan',
      parent_id: vendorMenu?.parent_id ?? null,
      createdBy: admin?._id,
    });
    console.log('[+] Menu "Customer" (/customer) dibuat');
  }

  // 9. POS + Outlet
  let posGroup = await Menu.findOne({ menu: 'POS', component: null });
  for (const item of POS_MENUS) {
    if (await Menu.exists({ component: item.component })) {
      console.log(`[=] Menu ${item.component} sudah ada`);
      continue;
    }
    if (!posGroup) {
      posGroup = await Menu.create({ menu: 'POS', icon: 'fa-solid fa-store', createdBy: admin?._id });
      console.log('[+] Menu grup "POS" dibuat');
    }
    await Menu.create({ ...item, parent_id: posGroup._id, createdBy: admin?._id });
    console.log(`[+] Menu "${item.menu}" (${item.component}) dibuat`);
  }
  if (await Menu.exists({ component: '/outlet' })) {
    console.log('[=] Menu /outlet sudah ada');
  } else {
    const gudangMenu = await Menu.findOne({ component: '/gudang' });
    await Menu.create({
      menu: 'Outlet', component: '/outlet', icon: 'fa-solid fa-store', resource: 'outlet',
      deskripsi: 'Toko / outlet POS dan gudang sumber stoknya', parent_id: gudangMenu?.parent_id ?? null, createdBy: admin?._id,
    });
    console.log('[+] Menu "Outlet" (/outlet) dibuat');
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
