const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { useTestApp } = require('../helpers/setup');
const { ok, createMasters, createProduct } = require('../helpers/factory');
const { importRegions } = require('../../helpers/regionHelper');
const { migrateRegionCodes } = require('../../scripts/migrate-region-codes');

const t = useTestApp();
const CIPAGANTI = '32.73.02.1001'; // Cipaganti, Coblong, Kota Bandung, Jawa Barat (kode pos 40131)

before(async () => { await importRegions(); });

test('region code on masters: names filled from master, postal code default, invalid / retired codes rejected, legacy text kept', async () => {
  const admin = await t.loginAs();

  // gudang: nama wilayah dari master (input teks diabaikan), kode pos kelurahan bila kosong
  const g = ok(await admin.post('/api/gudang', { code: 'BDG', name: 'Gudang Bandung', regionCode: CIPAGANTI, provinsi: 'ngawur', kodePos: '' }), 201);
  assert.deepEqual([g.provinsi, g.kota, g.kecamatan, g.kelurahan, g.kodePos], ['Jawa Barat', 'Kota Bandung', 'Coblong', 'Cipaganti', '40131']);
  // kode pos diisi user dipertahankan; pilih sampai kecamatan saja -> kelurahan kosong
  const g2 = ok(await admin.put(`/api/gudang/${g._id}`, { regionCode: '32.73.02', kodePos: '40135' }));
  assert.deepEqual([g2.kecamatan, g2.kelurahan, g2.kodePos, g2.regionCode], ['Coblong', '', '40135', '32.73.02']);

  assert.match((await admin.post('/api/gudang', { code: 'X1', name: 'X', regionCode: '32.73.02.9999' })).message, /Region not found/);
  assert.match((await admin.post('/api/gudang', { code: 'X2', name: 'X', regionCode: 'abc' })).message, /Invalid region code/);

  // tanpa kode (data lama): teks bebas tetap diterima
  const legacy = ok(await admin.post('/api/gudang', { code: 'OLD', name: 'Lama', provinsi: 'Jabar', kota: 'Bandung' }), 201);
  assert.equal(legacy.regionCode, null);
  assert.equal(legacy.kota, 'Bandung');

  // kode nonaktif: ditolak untuk data baru, tetap boleh untuk record yang sudah memakainya
  const Region = t.model('Region');
  await Region.updateOne({ _id: '32.73.02.1002' }, { $set: { isActive: false } });
  assert.match((await admin.post('/api/gudang', { code: 'X3', name: 'X', regionCode: '32.73.02.1002' })).message, /no longer valid/);
  await t.model('Gudang').updateOne({ _id: g._id }, { $set: { regionCode: '32.73.02.1002' } });
  ok(await admin.put(`/api/gudang/${g._id}`, { name: 'Gudang Bandung 2', regionCode: '32.73.02.1002' }));
  await Region.updateOne({ _id: '32.73.02.1002' }, { $set: { isActive: true } });

  // customer, vendor, outlet
  const c = ok(await admin.post('/api/customer', { name: 'Toko Dago', regionCode: CIPAGANTI }), 201);
  assert.equal(c.kelurahan, 'Cipaganti');
  const v = ok(await admin.post('/api/vendor', { companyName: 'CV Wilayah', picName: 'A', picContact: '1', companyAddress: 'Jl. 1', regionCode: '32.73' }), 201);
  assert.deepEqual([v.provinsi, v.kota, v.kecamatan, v.regionCode], ['Jawa Barat', 'Kota Bandung', '', '32.73']);
  const o = ok(await admin.post('/api/outlet', { code: 'OBDG', name: 'Outlet Bandung', gudang: g._id, regionCode: CIPAGANTI }), 201);
  assert.equal(o.kecamatan, 'Coblong');
  ok(await admin.put(`/api/customer/${c._id}`, { name: 'Toko Dago', regionCode: null, provinsi: 'Teks', kota: '', kecamatan: '', kelurahan: '' }));
  const c2 = await t.model('Customer').findById(c._id).lean();
  assert.equal(c2.regionCode, null);
  assert.equal(c2.provinsi, 'Teks');

  // audit mencatat kelurahan & kode wilayah
  const log = await t.model('AuditLog').findOne({ entity: 'gudang', entityId: g._id, action: 'update' }).lean();
  assert.ok(log.changes.some((ch) => ch.field === 'kelurahan'));
});

test('sales order ship-to: copies customer region, validates a changed region code', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const g = m.gudang;
  const lines = [{ sku: (await createProduct(admin, m, `Wilayah ${Date.now()}`))._id, qty: 1 }];
  const cust = ok(await admin.post('/api/customer', { name: 'Pelanggan Wilayah', address: 'Jl. Dago 1', regionCode: CIPAGANTI }), 201);
  const shipTo = ok(await admin.get(`/api/sales-order/ship-to/${cust._id}`)).shipTo;
  assert.equal(shipTo.regionCode, CIPAGANTI);
  assert.equal(shipTo.kelurahan, 'Cipaganti');

  const so = ok(await admin.post('/api/sales-order', { customer: cust._id, gudang: g._id, deliveryMethod: 'DELIVERY', lines }), 201);
  assert.equal(so.shipTo.kelurahan, 'Cipaganti');
  const so2 = ok(await admin.put(`/api/sales-order/${so._id}`, {
    customer: cust._id, gudang: g._id, deliveryMethod: 'DELIVERY', lines,
    shipTo: { name: 'Gudang Customer', alamat: 'Jl. Lain 2', regionCode: '32.73.02.1003', kelurahan: 'salah' },
  }));
  assert.equal(so2.shipTo.kelurahan, 'Sadang Serang');
  assert.equal(so2.shipTo.kodePos, '40133');
  const bad = await admin.put(`/api/sales-order/${so._id}`, {
    customer: cust._id, gudang: g._id, deliveryMethod: 'DELIVERY', lines, shipTo: { alamat: 'Jl. 3', regionCode: '99.99' },
  });
  assert.equal(bad.status, 400);
});

test('migrate:region-codes: matches legacy text (aliases, Kota vs Kabupaten by district), dry-run, partial, idempotent', async () => {
  const Gudang = t.model('Gudang');
  const Vendor = t.model('Vendor');
  const Customer = t.model('Customer');
  await Gudang.deleteMany({});
  await Customer.deleteMany({ regionCode: null });            // sisa test sebelumnya (teks bebas)
  await Gudang.create([
    { code: 'M1', name: 'A', provinsi: 'DKI Jakarta', kota: 'Jakarta Selatan', kecamatan: 'Kebayoran Baru' },
    { code: 'M2', name: 'B', provinsi: 'Jabar', kota: 'Bandung', kecamatan: 'Kec. Coblong' },      // Kota Bandung (Coblong)
    { code: 'M3', name: 'C', provinsi: 'Jawa Barat', kota: 'Kab. Bandung' },                       // Kabupaten
    { code: 'M4', name: 'D', provinsi: 'Jawa Barat', kota: 'Kota Bandung', kecamatan: 'Tidak Ada' }, // sebagian
    { code: 'M5', name: 'E', provinsi: 'Planet Mars' },                                             // tidak cocok
    { code: 'M6', name: 'F', kota: 'Surabaya' },                                                    // tanpa provinsi
  ]);
  await Vendor.create({ companyName: 'V Lama', picName: 'x', picContact: '1', companyAddress: 'x', provinsi: 'D.I. Yogyakarta', kota: 'Sleman' });

  const dry = await migrateRegionCodes();
  assert.equal(dry.written, 0);
  assert.equal(await Gudang.countDocuments({ regionCode: { $ne: null } }), 0);

  const r = await migrateRegionCodes({ apply: true });
  assert.ok(r.checked >= 7);
  assert.equal(r.unmatched, 1);
  assert.equal(r.partial, 1);
  const by = Object.fromEntries((await Gudang.find().lean()).map((g) => [g.code, g]));
  assert.equal(by.M1.regionCode, '31.74.07');
  assert.equal(by.M1.provinsi, 'Daerah Khusus Ibukota Jakarta');
  assert.equal(by.M2.regionCode, '32.73.02');
  assert.equal(by.M2.kota, 'Kota Bandung');
  assert.equal(by.M3.kota, 'Kabupaten Bandung');
  assert.equal(by.M4.regionCode, '32.73');
  assert.equal(by.M4.kecamatan, 'Tidak Ada');        // teks yang tidak cocok dibiarkan
  assert.equal(by.M5.regionCode, null);
  assert.equal(by.M6.provinsi, 'Jawa Timur');
  assert.equal((await Vendor.findOne({ companyName: 'V Lama' }).lean()).kota, 'Kabupaten Sleman');
  assert.ok(r.issues.some((i) => /Planet Mars/.test(i)));

  const again = await migrateRegionCodes({ apply: true });
  assert.equal(again.checked, 1); // hanya yang tidak cocok diperiksa lagi
  assert.equal(again.written, 0);
});
