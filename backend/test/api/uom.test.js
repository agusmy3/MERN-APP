const { test } = require('node:test');
const assert = require('node:assert/strict');
const { useTestApp } = require('../helpers/setup');
const { ok, createMasters, createProduct } = require('../helpers/factory');
const { guessType } = require('../../config/uom');

const t = useTestApp();

test('UoM type: required, validated and audited', async () => {
  const admin = await t.loginAs();
  assert.equal((await admin.post('/api/uom', { code: 'NOTYPE', name: 'x' })).status, 400);
  assert.equal((await admin.post('/api/uom', { code: 'BADTYPE', name: 'x', type: 'COLOR' })).status, 400);
  const u = ok(await admin.post('/api/uom', { code: 'LTRX', name: 'Liter', type: 'VOLUME' }), 201);
  assert.equal(u.type, 'VOLUME');
  const dd = ok(await admin.get('/api/uom/dropdown'));
  assert.equal(dd.find((d) => d._id === u._id).type, 'VOLUME');

  ok(await admin.put(`/api/uom/${u._id}`, { code: 'LTRX', name: 'Liter', type: 'WEIGHT' }));
  const log = await t.model('AuditLog').findOne({ entity: 'uom', entityId: u._id, action: 'update' }).lean();
  assert.equal(log.changes.find((c) => c.field === 'type').to, 'Weight'); // label, bukan kode
});

test('vendor price: purchase UoM must be convertible to the base UoM', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const sku = await createProduct(admin, m, 'Apel'); // satuan dasar PCS (Count)
  const kg = ok(await admin.post('/api/uom', { code: 'KGX', name: 'Kilogram', type: 'WEIGHT' }), 201);
  const price = (uomBeli, konversi) => admin.post('/api/vendor-price', { vendor: m.vendor._id, skus: [sku._id], uomBeli, konversi, hargaBeli: 1000 });

  // berat -> hitung: ditolak
  const bad = await price(kg._id, 6);
  assert.equal(bad.status, 400);
  assert.match(bad.message, /cannot be converted/);
  // kemasan -> hitung: boleh
  ok(await price(m.box._id, 12), 201);
  // satuan dasar sendiri: konversi wajib 1
  assert.equal((await price(m.pcs._id, 2)).status, 400);
  ok(await price(m.pcs._id, 1), 201);

  // ubah harga BOX menjadi KG lewat PUT -> ditolak juga
  const [boxPrice] = ok(await admin.get(`/api/vendor-price?sku=${sku._id}`)).filter((p) => p.uomBeli.code === m.box.code);
  assert.equal((await admin.put(`/api/vendor-price/${boxPrice._id}`, { uomBeli: kg._id, konversi: 6 })).status, 400);

  // jenis BOX tidak bisa diganti ke Weight selama harga BOX -> PCS ada
  const change = await admin.put(`/api/uom/${m.box._id}`, { code: m.box.code, name: 'Box', type: 'WEIGHT' });
  assert.equal(change.status, 400);
  assert.match(change.message, /vendor price/);

  // satuan dasar produk tidak bisa diganti ke KG selama ada harga BOX/PCS yang tidak cocok
  const prod = await admin.put(`/api/produk/${sku.produk._id}`, { name: 'Apel', kategori: m.kategori._id, uom: kg._id, variants: [] });
  assert.equal(prod.status, 400);
});

test('guess UoM type from code (migrate:uom-type)', () => {
  assert.equal(guessType('pcs'), 'COUNT');
  assert.equal(guessType('KG'), 'WEIGHT');
  assert.equal(guessType('SAK'), 'PACK');
  assert.equal(guessType('LTR'), 'VOLUME');
  assert.equal(guessType('XYZ'), null);
});
