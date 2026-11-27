const { test } = require('node:test');
const assert = require('node:assert/strict');
const { useTestApp } = require('../helpers/setup');
const { ok, createMasters, createProduct, postAdjustment } = require('../helpers/factory');

const t = useTestApp();

test('map points: layers by permission, missing coordinates, overdue & open-shift flags, region filter', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const Gudang = t.model('Gudang');
  await Gudang.updateOne({ _id: m.gudang._id }, { latitude: -6.9, longitude: 107.6, regionCode: '32.73.02', kota: 'Kota Bandung' });
  const noPoint = ok(await admin.post('/api/gudang', { code: 'NOPT', name: 'Tanpa Titik' }), 201);
  const sku = await createProduct(admin, m, `Peta ${Date.now()}`);
  await t.model('ProdukSku').updateOne({ _id: sku._id }, { hargaJual: 100000 });
  await postAdjustment(admin, m.gudang._id, [{ sku: sku._id, qtyChange: 10, unitCost: 60000 }], 'OPENING');

  const late = ok(await admin.post('/api/customer', { name: 'Telat Bayar', latitude: -6.91, longitude: 107.61, termDays: 7 }), 201);
  const good = ok(await admin.post('/api/customer', { name: 'Lancar', latitude: -6.2, longitude: 106.8 }), 201);
  ok(await admin.post('/api/customer', { name: 'Belum Ada Titik' }), 201);
  await t.model('Customer').updateOne({ _id: late._id }, { regionCode: '32.73.02.1001' });
  await t.model('Customer').updateOne({ _id: good._id }, { regionCode: '31.74' });
  const inv = ok(await admin.post('/api/sales-invoice', { customer: late._id, gudang: m.gudang._id, lines: [{ sku: sku._id, qty: 2 }] }), 201);
  ok(await admin.post(`/api/sales-invoice/${inv._id}/post`, {}));
  await t.model('SalesInvoice').updateOne({ _id: inv._id }, { dueDate: new Date(Date.now() - 3 * 86400000) });

  const outlet = ok(await admin.post('/api/outlet', { code: 'OPETA', name: 'Outlet Peta', gudang: m.gudang._id, latitude: -6.92, longitude: 107.62 }), 201);

  // super admin: semua lapisan + penanda
  const all = ok(await admin.get('/api/map/points')).layers;
  assert.deepEqual(Object.keys(all).sort(), ['customer', 'gudang', 'outlet', 'vendor']);
  assert.ok(all.gudang.points.some((p) => String(p.id) === String(m.gudang._id) && p.lat === -6.9 && p.outlets === 1));
  assert.ok(all.gudang.missing.some((p) => String(p.id) === String(noPoint._id)));
  assert.equal(all.customer.points.find((p) => p.name === 'Telat Bayar').overdue, true);
  assert.equal(all.customer.points.find((p) => p.name === 'Lancar').overdue, false);
  assert.ok(all.customer.missing.some((p) => p.name === 'Belum Ada Titik'));
  assert.ok(!all.customer.points.concat(all.customer.missing).some((p) => p.name === 'Umum / Walk-in'));
  assert.equal(all.outlet.points.find((p) => String(p.id) === String(outlet._id)).shiftOpen, false);

  // filter wilayah: awalan kode
  const bdg = ok(await admin.get('/api/map/points?region=32.73')).layers;
  assert.deepEqual(bdg.customer.points.map((p) => p.name), ['Telat Bayar']);
  assert.equal((await admin.get('/api/map/points?region=x')).status, 400);

  // user map + customer saja: hanya lapisan customer, tanpa penanda overdue
  const sales = await t.loginAs({ map: [], customer: [] }, 'Map Customer');
  const only = ok(await sales.get('/api/map/points')).layers;
  assert.deepEqual(Object.keys(only), ['customer']);
  assert.equal(only.customer.points[0].overdue, undefined);
  // tanpa map:view -> 403
  const noMap = await t.loginAs({ customer: [] }, 'No Map');
  assert.equal((await noMap.get('/api/map/points')).status, 403);
});

test('map summary: figures filtered per permission and warehouse access', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const other = ok(await admin.post('/api/gudang', { code: `G${Date.now() % 100000}`, name: 'Gudang Lain' }), 201);
  const sku = await createProduct(admin, m, `Ringkas ${Date.now()}`);
  await t.model('ProdukSku').updateOne({ _id: sku._id }, { hargaJual: 100000 });
  await postAdjustment(admin, m.gudang._id, [{ sku: sku._id, qtyChange: 10, unitCost: 60000 }], 'OPENING');
  const cust = ok(await admin.post('/api/customer', { name: 'Ringkasan', creditLimit: 1000000 }), 201);
  const inv = ok(await admin.post('/api/sales-invoice', { customer: cust._id, gudang: m.gudang._id, lines: [{ sku: sku._id, qty: 2 }] }), 201);
  ok(await admin.post(`/api/sales-invoice/${inv._id}/post`, {}));

  const label = (data, l) => data.items.find((i) => i.label === l);
  const full = ok(await admin.get(`/api/map/summary/customer/${cust._id}`));
  assert.equal(full.title, 'Ringkasan');
  assert.ok(label(full, 'Receivable').value > 0);
  assert.equal(label(full, 'Credit limit').value, 1000000);
  assert.ok(label(full, 'Net sales (30 days)').value > 0);
  assert.equal(label(full, 'Active sales orders').value, 0);

  const g = ok(await admin.get(`/api/map/summary/gudang/${m.gudang._id}`));
  assert.equal(label(g, 'SKUs in stock').value, 1);
  assert.equal(label(g, 'Stock value').value, 480000); // 8 tersisa x 60.000

  // user terbatas: customer tanpa penjualan / SO; gudang tanpa nilai stok; gudang lain tanpa akses
  const limited = await t.loginAs({ map: [], customer: [], gudang: [] }, 'Map Terbatas', { gudangs: [m.gudang._id] });
  const c2 = ok(await limited.get(`/api/map/summary/customer/${cust._id}`));
  assert.ok(label(c2, 'Receivable'));
  assert.equal(label(c2, 'Net sales (30 days)'), undefined);
  assert.equal(label(c2, 'Active sales orders'), undefined);
  const g2 = ok(await limited.get(`/api/map/summary/gudang/${m.gudang._id}`));
  assert.equal(label(g2, 'SKUs in stock').value, 1);
  assert.equal(label(g2, 'Stock value'), undefined);
  const g3 = ok(await limited.get(`/api/map/summary/gudang/${other._id}`));
  assert.equal(label(g3, 'SKUs in stock'), undefined);
  assert.match(label(g3, 'Stock').value, /akses/);

  assert.equal((await limited.get(`/api/map/summary/vendor/${m.vendor?._id || cust._id}`)).status, 403); // tanpa vendor:view
  assert.equal((await admin.get(`/api/map/summary/planet/${cust._id}`)).status, 400);
  assert.equal((await admin.get('/api/map/summary/customer/123')).status, 400);
  assert.equal((await admin.get(`/api/map/summary/customer/${m.gudang._id}`)).status, 404);

  const o = ok(await admin.post('/api/outlet', { code: 'ORING', name: 'Outlet Ringkas', gudang: m.gudang._id }), 201);
  const os = ok(await admin.get(`/api/map/summary/outlet/${o._id}?tz=Asia/Jakarta`));
  assert.equal(label(os, 'Sales today').value, 0);
  assert.equal(label(os, 'Open shifts').value, 'Tidak ada');
});
