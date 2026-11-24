const { test } = require('node:test');
const assert = require('node:assert/strict');
const { useTestApp } = require('../helpers/setup');
const { ok, createMasters, createProduct, postAdjustment } = require('../helpers/factory');

const t = useTestApp();
const skuDoc = (id) => t.model('ProdukSku').findById(id).lean();

test('opening balance: unit cost required for SKU without HPP and feeds the average', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const a = await createProduct(admin, m, 'Kipas');
  const b = await createProduct(admin, m, 'TV');

  const doc = ok(await admin.post('/api/stock-adjustment', {
    type: 'ADJUSTMENT', gudang: m.gudang._id, reason: 'OPENING',
    lines: [{ sku: a._id, qtyChange: 10, unitCost: 150000 }, { sku: b._id, qtyChange: 5 }],
  }), 201);
  const rejected = await admin.post(`/api/stock-adjustment/${doc._id}/post`);
  assert.equal(rejected.status, 400);
  assert.match(rejected.message, new RegExp(b.sku));

  ok(await admin.put(`/api/stock-adjustment/${doc._id}`, {
    gudang: m.gudang._id, reason: 'OPENING',
    lines: [{ sku: a._id, qtyChange: 10, unitCost: 150000 }, { sku: b._id, qtyChange: 5, unitCost: 2000000 }],
  }));
  // user tanpa izin biaya: tidak bisa mengisi / melihat harga pokok, yang sudah ada dipertahankan
  const clerk = await t.loginAs({ stockAdjustment: ['create', 'update'] });
  const upd = ok(await clerk.put(`/api/stock-adjustment/${doc._id}`, {
    gudang: m.gudang._id, reason: 'OPENING', note: 'by clerk',
    lines: [{ sku: a._id, qtyChange: 10 }, { sku: b._id, qtyChange: 5, unitCost: 1 }],
  }));
  assert.ok(upd.lines.every((l) => l.unitCost === undefined));
  const view = ok(await clerk.get(`/api/stock-adjustment/${doc._id}`));
  assert.ok(view.lines.every((l) => l.unitCost === undefined && l.inputCost === undefined));

  ok(await admin.post(`/api/stock-adjustment/${doc._id}/post`));
  assert.equal((await skuDoc(a._id)).avgCost, 150000);
  assert.equal((await skuDoc(b._id)).avgCost, 2000000);

  const second = await postAdjustment(admin, m.gudang._id, [{ sku: a._id, qtyChange: 10, unitCost: 170000 }], 'OPENING');
  assert.equal((await skuDoc(a._id)).avgCost, 160000);
  ok(await admin.post(`/api/stock-adjustment/${second._id}/cancel`, { reason: 'salah' }));
  assert.equal((await skuDoc(a._id)).avgCost, 150000);
});

test('cost revaluation: set HPP without changing stock; cancel guarded', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const g2 = ok(await admin.post('/api/gudang', { code: 'REV-2', name: 'Second' }), 201);
  const c = await createProduct(admin, m, 'Chiki');
  await postAdjustment(admin, m.gudang._id, [{ sku: c._id, qtyChange: 8 }]);
  await postAdjustment(admin, g2._id, [{ sku: c._id, qtyChange: 2 }]);

  const missing = ok(await admin.get('/api/cost-revaluation/skus', { missingOnly: 'true' }));
  assert.ok(missing.some((s) => s.sku === c.sku && s.qty === 10));
  assert.equal((await admin.post('/api/cost-revaluation', { lines: [{ sku: c._id, newCost: 5000 }] })).status, 400);

  const rv = ok(await admin.post('/api/cost-revaluation', { note: 'HPP stok lama', lines: [{ sku: c._id, newCost: 5000 }] }), 201);
  assert.match(rv.no, /^REV-/);
  const posted = ok(await admin.post(`/api/cost-revaluation/${rv._id}/post`));
  assert.equal(posted.lines[0].oldCost, null);
  assert.equal(posted.lines[0].valueChange, 50000);
  const s = await skuDoc(c._id);
  assert.equal(s.avgCost, 5000);
  assert.equal(s.stok, 10);
  const mv = await t.model('StockMovement').find({ refId: rv._id }).lean();
  assert.deepEqual(mv.map((x) => x.value).sort((x, y) => x - y), [10000, 40000]);
  assert.ok(mv.every((x) => x.qty === 0 && x.type === 'REVALUATION'));

  const op = await postAdjustment(admin, m.gudang._id, [{ sku: c._id, qtyChange: 10, unitCost: 7000 }], 'OPENING');
  const blocked = await admin.post(`/api/cost-revaluation/${rv._id}/cancel`, { reason: 'x' });
  assert.equal(blocked.status, 400);
  assert.match(blocked.message, /changed/);
  ok(await admin.post(`/api/stock-adjustment/${op._id}/cancel`, { reason: 'undo' }));
  ok(await admin.post(`/api/cost-revaluation/${rv._id}/cancel`, { reason: 'salah' }));
  assert.equal((await skuDoc(c._id)).avgCost, null);
});

test('stock valuation groups & missing-cost flag', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const a = await createProduct(admin, m, 'Valued');
  const b = await createProduct(admin, m, 'Unvalued');
  await postAdjustment(admin, m.gudang._id, [{ sku: a._id, qtyChange: 4, unitCost: 1000 }], 'OPENING');
  await postAdjustment(admin, m.gudang._id, [{ sku: b._id, qtyChange: 3 }]);

  const bySku = ok(await admin.get('/api/stock-valuation', { gudang: m.gudang._id }));
  assert.equal(bySku.totals.value, 4000);
  assert.equal(bySku.totals.missingCost, 1);
  const byWh = ok(await admin.get('/api/stock-valuation', { groupBy: 'gudang', gudang: m.gudang._id }));
  assert.equal(byWh.rows[0].missingCost, 1);
  assert.equal(byWh.rows[0].skuCount, 2);
  assert.equal(byWh.rows[0].qty, undefined);
  const onlyMissing = ok(await admin.get('/api/stock-valuation', { missingOnly: 'true', gudang: m.gudang._id }));
  assert.deepEqual(onlyMissing.rows.map((r) => r.sku.sku), [b.sku]);
});
