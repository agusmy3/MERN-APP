/**
 * Script `npm run init` & `npm run demo` dijalankan sungguhan (child process) ke MongoDB sementara
 * milik test, lalu hasilnya diperiksa lewat API. Tidak pernah menyentuh database di .env:
 * MONGO_URI selalu diisi URI test (dotenv tidak menimpa env yang sudah ada).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const { useTestApp } = require('../helpers/setup');
const { ROLE_TEMPLATES } = require('../../config/roles');

const t = useTestApp();
const ADMIN = { email: 'root@init.test', password: 'RahasiaKuat123' };
const DEMO_PASSWORD = 'DemoPass123';

const run = (script, args, env = {}) => {
  assert.ok(t.mongoUri, 'test database URI missing');
  const res = spawnSync(process.execPath, [path.join(__dirname, '..', '..', 'scripts', script), ...args], {
    env: { ...process.env, MONGO_URI: t.mongoUri, NODE_ENV: 'test', ADMIN_EMAIL: '', ADMIN_PASSWORD: '', DEMO_PASSWORD: '', ...env },
    encoding: 'utf8',
    timeout: 120000,
  });
  return { code: res.status, out: `${res.stdout}\n${res.stderr}` };
};

const login = async (email, password) => {
  const res = await fetch(`${t.baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  assert.equal(res.status, 200, json.message);
  const token = json.data?.token ?? json.token;
  const get = async (url) => {
    const r = await fetch(t.baseUrl + url, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, data: j.data };
  };
  return { get };
};

test('init: guards, wipe, menus, roles, super admin, walk-in customer', async () => {
  // data lama yang harus terhapus
  await t.model('Kategori').create({ name: 'Data Lama' });

  let r = run('init.js', [`--email=${ADMIN.email}`, `--password=${ADMIN.password}`]);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /--wipe/);
  r = run('init.js', ['--wipe', `--email=${ADMIN.email}`, `--password=${ADMIN.password}`], { NODE_ENV: 'production' });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /--force/);
  r = run('init.js', ['--wipe', `--email=${ADMIN.email}`, '--password=short']);
  assert.notEqual(r.code, 0);
  assert.equal(await t.model('Kategori').countDocuments(), 1); // belum dihapus

  r = run('init.js', ['--wipe', `--email=${ADMIN.email}`, `--password=${ADMIN.password}`, '--ppn=12']);
  assert.equal(r.code, 0, r.out);
  assert.equal(await t.model('Kategori').countDocuments(), 0);

  const admin = await login(ADMIN.email, ADMIN.password);
  const tree = (await admin.get('/api/menu/tree')).data;
  const flat = (list) => list.flatMap((m) => [m, ...flat(m.children || [])]);
  const routes = flat(tree).map((m) => m.component).filter(Boolean);
  for (const route of ['/', '/produk', '/stock-adjustment', '/purchase-order', '/quotation', '/sales-order', '/delivery-order', '/sales-invoice', '/pos', '/pos-shift', '/outlet', '/settings']) {
    assert.ok(routes.includes(route), `menu ${route}`);
  }
  const roles = (await admin.get('/api/role/dropdown')).data.map((x) => x.name);
  for (const tpl of ROLE_TEMPLATES) assert.ok(roles.includes(tpl.name), tpl.name);
  assert.ok(roles.includes('Super Admin'));
  const settings = (await admin.get('/api/setting')).data.values;
  assert.equal(settings['tax.ppnRate'], 12);
  const customers = (await admin.get('/api/customer/dropdown')).data;
  assert.equal(customers.length, 1);
  assert.equal(customers[0].isWalkIn, true);
  assert.ok(await t.model('AuditLog').exists({ entity: 'role' }));
});

test('demo: master, stock, users per role with scoped access, sample transactions', async () => {
  let r = run('demo.js', ['--password=x']);
  assert.notEqual(r.code, 0); // password terlalu pendek
  r = run('demo.js', [`--password=${DEMO_PASSWORD}`, '--pin=1234']);
  assert.equal(r.code, 0, r.out);
  assert.equal((await t.model('User').findOne({ email: 'spv.toko@demo.local' }).lean()).hasPosPin, true);
  r = run('demo.js', [`--password=${DEMO_PASSWORD}`]);
  assert.notEqual(r.code, 0); // ditolak: sudah ada data
  assert.match(r.out, /sudah berisi data/);

  assert.equal(await t.model('Gudang').countDocuments(), 2);
  assert.equal(await t.model('Outlet').countDocuments(), 2);
  assert.ok(await t.model('Kategori').countDocuments() >= 2);
  assert.ok(await t.model('Produk').countDocuments() >= 5);
  assert.ok(await t.model('ProdukSku').countDocuments({ barcode: { $type: 'string' } }) >= 5);
  const outlet = await t.model('Outlet').findOne({ code: 'TOKO-JKT' }).lean();
  assert.equal(outlet.kodePos, '10710');
  assert.ok(outlet.latitude && outlet.longitude && outlet.provinsi && outlet.kota && outlet.kecamatan);

  const so = await t.model('SalesOrder').findOne().lean();
  assert.equal(so.status, 'PARTIAL');
  assert.equal(await t.model('DeliveryOrder').countDocuments({ status: 'POSTED', invoice: null }), 1);
  assert.equal((await t.model('Customer').findOne({ code: 'CUST00002' }).lean()).kota, 'Surabaya');
  assert.equal((await t.model('Customer').findOne({ code: 'CUST00002' }).lean()).creditLimit, 25000000);
  assert.equal(await t.model('Quotation').countDocuments({ status: 'SENT' }), 1);

  // kartu stok konsisten dengan saldo
  const rec = run('stock-reconcile.js', []);
  assert.equal(rec.code, 0, rec.out);

  // 1 user per role, akses sesuai role
  for (const tpl of ROLE_TEMPLATES) {
    const role = await t.model('Role').findOne({ name: tpl.name }).lean();
    assert.ok(await t.model('User').exists({ role: role._id }), `user for ${tpl.name}`);
  }
  const owner = await login('owner@demo.local', DEMO_PASSWORD);
  const dash = (await owner.get('/api/dashboard')).data;
  assert.ok(dash.sales.month.value > 0);
  assert.ok(dash.receivables.outstanding > 0);
  assert.ok(dash.reorder.needAction > 0);
  assert.ok(dash.inventoryValue > 0);
  assert.equal((await owner.get('/api/stock-valuation')).status, 200); // owner boleh melihat biaya

  const kasir = await login('kasir.jkt@demo.local', DEMO_PASSWORD);
  const ctx = (await kasir.get('/api/pos/context')).data;
  assert.deepEqual(ctx.outlets.map((o) => o.code), ['TOKO-JKT']);
  assert.equal(ctx.shift, null); // shift contoh sudah ditutup
  assert.equal((await kasir.get('/api/produk')).status, 403);

  const staff = await login('gudang@demo.local', DEMO_PASSWORD);
  const docs = (await staff.get('/api/stock-adjustment')).data.dataStockAdjustment;
  assert.ok(docs.length > 0);
  assert.ok(docs.every((d) => d.gudang?.code === 'MAIN')); // hanya gudang yang ditugaskan
  assert.equal((await staff.get('/api/stock-valuation')).status, 403); // tanpa data biaya

  const shifts = (await (await login('spv.toko@demo.local', DEMO_PASSWORD)).get('/api/pos-shift')).data.dataPosShift;
  assert.equal(shifts.length, 1);
  assert.equal(shifts[0].status, 'CLOSED');
  assert.equal(shifts[0].difference, 0);
});
