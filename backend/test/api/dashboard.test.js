const { test } = require('node:test');
const assert = require('node:assert/strict');
const { useTestApp } = require('../helpers/setup');
const { ok, createMasters, createProduct, postAdjustment } = require('../helpers/factory');

const t = useTestApp();

test('dashboard: widgets for admin with correct numbers', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const a = await createProduct(admin, m, 'Dash A');
  const b = await createProduct(admin, m, 'Dash B');
  await postAdjustment(admin, m.gudang._id, [{ sku: a._id, qtyChange: 10, unitCost: 1000 }], 'OPENING');
  await postAdjustment(admin, m.gudang._id, [{ sku: b._id, qtyChange: 2 }]);
  await postAdjustment(admin, m.gudang._id, [{ sku: a._id, qtyChange: -3 }], 'DAMAGED');
  ok(await admin.put('/api/reorder/rules', { rules: [{ sku: b._id, gudang: m.gudang._id, minQty: 5, maxQty: 20 }] }));
  ok(await admin.post('/api/stock-adjustment', { type: 'ADJUSTMENT', gudang: m.gudang._id, reason: 'LOST', lines: [{ sku: a._id, qtyChange: -1 }] }), 201);
  const po = ok(await admin.post('/api/purchase-order', {
    vendor: m.vendor._id, gudang: m.gudang._id, issue: true, expectedDate: new Date().toISOString().slice(0, 10),
    lines: [{ sku: a._id, uomBeli: m.pcs._id, konversi: 1, qty: 4, hargaBeli: 1100, diskonPersen: 10 }],
  }), 201);
  const gr = ok(await admin.post('/api/goods-receipt', { purchaseOrder: po._id, lines: [{ poLine: po.lines[0]._id, qty: 1 }] }), 201);
  ok(await admin.post(`/api/goods-receipt/${gr._id}/post`));

  const d = ok(await admin.get('/api/dashboard', { tz: 'Asia/Jakarta' }));
  assert.equal(d.canSeeCost, true);
  assert.equal(d.activeSkus, 2);
  // A: 7 @1000 + 1 @990 -> avg (7000 + 990) / 8 = 998.75 -> 8 x 998.75 = 7990
  assert.equal(d.inventoryValue, 7990);
  assert.equal(d.skuWithoutHpp, 1);
  assert.equal(d.valueByGudang[0].value, 7990);
  assert.equal(d.reorder.CRITICAL, 1);
  assert.equal(d.reorder.items[0].sku.sku, b.sku);
  assert.equal(d.openPo.count, 1);
  assert.equal(d.openPo.outstandingValue, 2970);           // 3 x 1100 x 0.9
  assert.equal(d.pending.stockAdjustment, 1);
  assert.equal(d.purchasesByMonth.length, 6);
  assert.equal(d.purchasesByMonth[5].value, 990);
  assert.equal(d.movementsByDay.length, 30);
  const today = d.movementsByDay[29];
  assert.equal(today.in, 13);                              // 10 + 2 + 1
  assert.equal(today.out, 3);
  assert.ok(d.recentActivity.length > 0 && d.recentActivity.length <= 10);
});

test('dashboard: widgets follow permissions (no cost data without vendorPrice:view)', async () => {
  const clerk = await t.loginAs({ stockMovement: [], stockAdjustment: [] });
  const d = ok(await clerk.get('/api/dashboard'));
  assert.equal(d.canSeeCost, false);
  for (const key of ['inventoryValue', 'valueByGudang', 'purchasesByMonth', 'reorder', 'openPo', 'recentActivity', 'activeSkus']) {
    assert.equal(d[key], undefined, key);
  }
  assert.ok(Array.isArray(d.movementsByDay));
  assert.ok(d.movementsByDay.every((x) => x.valueIn === undefined));
  assert.deepEqual(Object.keys(d.pending), ['stockAdjustment']);
  assert.equal((await t.anonymous().get('/api/dashboard')).status, 401);
});
