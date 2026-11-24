const { test } = require('node:test');
const assert = require('node:assert/strict');
const { useTestApp } = require('../helpers/setup');
const { ok, createMasters, createProduct, postAdjustment } = require('../helpers/factory');

const t = useTestApp();

test('rules: upsert, validation, delete by clearing, audited under the product', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const a = await createProduct(admin, m, 'Rule A');
  assert.equal((await admin.put('/api/reorder/rules', { rules: [{ sku: a._id, gudang: m.gudang._id, minQty: 10, maxQty: 5 }] })).status, 400);
  assert.equal((await admin.put('/api/reorder/rules', { rules: [{ sku: a._id, gudang: m.gudang._id, minQty: 1.555, maxQty: 5 }] })).status, 400);
  const saved = await admin.put('/api/reorder/rules', { rules: [{ sku: a._id, gudang: m.gudang._id, minQty: 10, maxQty: 50 }] });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.created, 1);
  ok(await admin.put('/api/reorder/rules', { rules: [{ sku: a._id, gudang: m.gudang._id, minQty: 12, maxQty: 50 }] }));
  const rules = ok(await admin.get('/api/reorder/rules', { produk: a.produk._id }));
  assert.equal(rules[0].minQty, 12);
  const hist = ok(await admin.get('/api/audit-log/history', { entity: 'produk', id: a.produk._id }));
  assert.ok(hist.logs.some((l) => l.entity === 'reorderRule' && l.action === 'update'));
  const removed = ok(await admin.put('/api/reorder/rules', { rules: [{ sku: a._id, gudang: m.gudang._id, minQty: '', maxQty: '' }] }));
  assert.equal(removed.removed, 1);

  const viewer = await t.loginAs({ reorder: [] });
  assert.equal((await viewer.put('/api/reorder/rules', { rules: [{ sku: a._id, gudang: m.gudang._id, minQty: 1, maxQty: 2 }] })).status, 403);
});

test('alerts: OUT / CRITICAL / ORDERED with open PO counted, suggestion in purchase UoM', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const out = await createProduct(admin, m, 'Habis');
  const crit = await createProduct(admin, m, 'Kritis');
  const fine = await createProduct(admin, m, 'Aman');
  await postAdjustment(admin, m.gudang._id, [{ sku: crit._id, qtyChange: 5 }, { sku: fine._id, qtyChange: 100 }]);
  // vendor utama: BOX isi 12, min. order 2
  ok(await admin.post('/api/vendor-price', { vendor: m.vendor._id, skus: [out._id, crit._id], uomBeli: m.box._id, konversi: 12, hargaBeli: 120000, isPreferred: true, minOrder: 2 }), 201);
  ok(await admin.put('/api/reorder/rules', { rules: [
    { sku: out._id, gudang: m.gudang._id, minQty: 10, maxQty: 50 },
    { sku: crit._id, gudang: m.gudang._id, minQty: 10, maxQty: 100 },
    { sku: fine._id, gudang: m.gudang._id, minQty: 10, maxQty: 50 },
  ] }));

  let rows = ok(await admin.get('/api/reorder', { gudang: m.gudang._id }));
  const byName = (n) => rows.find((r) => r.produk.name === n);
  assert.deepEqual(rows.map((r) => r.status), ['OUT', 'CRITICAL']);
  assert.equal(byName('Habis').suggestedQty, 50);
  assert.equal(byName('Habis').suggestion.qty, 5);           // ceil(50 / 12)
  assert.equal(byName('Kritis').suggestedQty, 95);
  assert.equal(byName('Kritis').suggestion.qty, 8);          // ceil(95 / 12)
  assert.equal(byName('Habis').suggestion.value, 600000);

  // PO terbuka menutupi kekurangan -> ORDERED, tidak disarankan lagi
  ok(await admin.post('/api/purchase-order', {
    vendor: m.vendor._id, gudang: m.gudang._id, issue: true,
    lines: [{ sku: crit._id, uomBeli: m.box._id, konversi: 12, qty: 8, hargaBeli: 120000 }],
  }), 201);
  rows = ok(await admin.get('/api/reorder', { gudang: m.gudang._id }));
  const kritis = rows.find((r) => r.produk.name === 'Kritis');
  assert.equal(kritis.status, 'ORDERED');
  assert.equal(kritis.onOrder, 96);
  assert.equal(kritis.suggestedQty, 0);

  const all = ok(await admin.get('/api/reorder', { gudang: m.gudang._id, status: 'ALL' }));
  assert.equal(all.length, 3);
  const summary = ok(await admin.get('/api/reorder/summary'));
  assert.equal(summary.OUT, 1);
  assert.equal(summary.ORDERED, 1);
  assert.equal(summary.needAction, 1);
});

test('create PO from alerts: one draft per vendor + warehouse; needs purchaseOrder:create', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const v2 = ok(await admin.post('/api/vendor', { companyName: 'Vendor Dua', picName: 'x', picContact: 'x', companyAddress: 'x' }), 201);
  const a = await createProduct(admin, m, 'PO A');
  const b = await createProduct(admin, m, 'PO B');
  const c = await createProduct(admin, m, 'PO C');
  const items = [
    { sku: a._id, gudang: m.gudang._id, vendor: m.vendor._id, uomBeli: m.pcs._id, konversi: 1, qty: 5, hargaBeli: 1000 },
    { sku: b._id, gudang: m.gudang._id, vendor: m.vendor._id, uomBeli: m.box._id, konversi: 12, qty: 2, hargaBeli: 10000 },
    { sku: c._id, gudang: m.gudang._id, vendor: v2._id, uomBeli: m.pcs._id, konversi: 1, qty: 1, hargaBeli: 500 },
  ];
  const viewer = await t.loginAs({ reorder: [] });
  assert.equal((await viewer.post('/api/reorder/create-po', { items })).status, 403);

  const res = await admin.post('/api/reorder/create-po', { items });
  assert.equal(res.status, 201);
  assert.equal(res.data.length, 2);
  const pos = await t.model('PurchaseOrder').find({ _id: { $in: res.data.map((p) => p._id) } }).lean();
  assert.ok(pos.every((p) => p.status === 'DRAFT'));
  assert.deepEqual(pos.map((p) => p.lines.length).sort(), [1, 2]);

  // satu item tidak valid -> semua batal (1 transaksi)
  const before = await t.model('PurchaseOrder').countDocuments();
  const bad = await admin.post('/api/reorder/create-po', { items: [items[0], { ...items[2], qty: 0 }] });
  assert.equal(bad.status, 400);
  assert.equal(await t.model('PurchaseOrder').countDocuments(), before);
});

test('inactive SKU is not monitored; deleting a SKU removes its rules', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const a = await createProduct(admin, m, 'Nonaktif');
  const b = await createProduct(admin, m, 'Dihapus');
  ok(await admin.put('/api/reorder/rules', { rules: [
    { sku: a._id, gudang: m.gudang._id, minQty: 1, maxQty: 2 },
    { sku: b._id, gudang: m.gudang._id, minQty: 1, maxQty: 2 },
  ] }));
  ok(await admin.put(`/api/produk/${a.produk._id}/sku`, { skus: [{ _id: a._id, sku: a.sku, hargaJual: 0, isActive: false }] }));
  const rows = ok(await admin.get('/api/reorder', { gudang: m.gudang._id }));
  assert.ok(!rows.some((r) => r.produk.name === 'Nonaktif'));
  ok(await admin.del(`/api/produk/${b.produk._id}`));
  assert.equal(await t.model('ReorderRule').countDocuments({ sku: b._id }), 0);
});
