const { test } = require('node:test');
const assert = require('node:assert/strict');
const { useTestApp } = require('../helpers/setup');
const { ok, createMasters, createProduct, postAdjustment } = require('../helpers/factory');

const t = useTestApp();

/** 2 gudang (A, B), 1 SKU berstok di keduanya, 1 dokumen adjustment & PO di masing-masing */
async function setup(admin) {
  const m = await createMasters(admin);
  const A = m.gudang;
  const B = ok(await admin.post('/api/gudang', { code: `${A.code}X`, name: 'Gudang B' }), 201);
  const sku = await createProduct(admin, m, 'Akses');
  const adjA = await postAdjustment(admin, A._id, [{ sku: sku._id, qtyChange: 5, unitCost: 100 }], 'OPENING');
  const adjB = await postAdjustment(admin, B._id, [{ sku: sku._id, qtyChange: 7 }]);
  const poLine = { sku: sku._id, uomBeli: m.pcs._id, konversi: 1, qty: 3, hargaBeli: 100 };
  const poA = ok(await admin.post('/api/purchase-order', { vendor: m.vendor._id, gudang: A._id, lines: [poLine], issue: true }), 201);
  const poB = ok(await admin.post('/api/purchase-order', { vendor: m.vendor._id, gudang: B._id, lines: [poLine], issue: true }), 201);
  return { m, A, B, sku, adjA, adjB, poA, poB, poLine };
}

const FULL = {
  stockAdjustment: ['create', 'update', 'delete', 'post'],
  stockMovement: [],
  purchaseOrder: ['create', 'update', 'delete'],
  goodsReceipt: ['create', 'update', 'delete', 'post'],
  reorder: ['update'],
  vendorPrice: [],
};

test('restricted user only sees & changes documents of assigned warehouses', async () => {
  const admin = await t.loginAs();
  const s = await setup(admin);
  const user = await t.loginAs(FULL, 'Staf A', { gudangs: [s.A._id] });

  // me + dropdown
  const me = ok(await user.get('/api/auth/me'));
  assert.equal(me.gudangAccess.all, false);
  assert.deepEqual(me.gudangAccess.gudangs.map((g) => g.code), [s.A.code]);
  const dd = ok(await user.get('/api/gudang/dropdown'));
  assert.equal(dd.find((g) => g._id === s.A._id).accessible, true);
  assert.equal(dd.find((g) => g._id === s.B._id).accessible, false);

  // stock adjustment
  const list = ok(await user.get('/api/stock-adjustment'));
  assert.deepEqual(list.dataStockAdjustment.map((d) => d.no), [s.adjA.no]);
  assert.equal((await user.get('/api/stock-adjustment', { gudang: s.B._id })).status, 403);
  assert.equal((await user.get(`/api/stock-adjustment/${s.adjB._id}`)).status, 403);
  assert.equal((await user.post(`/api/stock-adjustment/${s.adjB._id}/cancel`, { reason: 'x' })).status, 403);
  const body = { type: 'ADJUSTMENT', reason: 'DAMAGED', lines: [{ sku: s.sku._id, qtyChange: -1 }] };
  assert.equal((await user.post('/api/stock-adjustment', { ...body, gudang: s.B._id })).status, 403);
  const mine = ok(await user.post('/api/stock-adjustment', { ...body, gudang: s.A._id }), 201);
  assert.equal((await user.put(`/api/stock-adjustment/${mine._id}`, { ...body, gudang: s.B._id })).status, 403);
  ok(await user.post(`/api/stock-adjustment/${mine._id}/post`));

  // kartu stok, saldo, valuasi
  const mv = ok(await user.get('/api/stock-movement'));
  assert.ok(mv.dataMovement.length > 0);
  assert.ok(mv.dataMovement.every((x) => x.gudang._id === s.A._id));
  assert.equal((await user.get('/api/stock-movement', { gudang: s.B._id })).status, 403);
  const bal = ok(await user.get('/api/stock-movement/balance', { produk: s.sku.produk._id }));
  assert.equal(bal.length, 2); // jumlah stok gudang lain tetap terlihat
  assert.equal(bal.find((b) => b.gudang._id === s.B._id).accessible, false);
  const val = ok(await user.get('/api/stock-valuation', { groupBy: 'gudang' }));
  assert.deepEqual(val.rows.map((r) => r.gudang.code), [s.A.code]);

  // PO & GR
  const pos = ok(await user.get('/api/purchase-order'));
  assert.deepEqual(pos.dataPurchaseOrder.map((p) => p.no), [s.poA.no]);
  assert.equal((await user.get(`/api/purchase-order/${s.poB._id}`)).status, 403);
  assert.equal((await user.post('/api/purchase-order', { vendor: s.m.vendor._id, gudang: s.B._id, lines: [s.poLine] })).status, 403);
  const options = ok(await user.get('/api/goods-receipt/po-options'));
  assert.deepEqual(options.map((p) => p.no), [s.poA.no]);
  assert.equal((await user.get(`/api/goods-receipt/from-po/${s.poB._id}`)).status, 403);
  const poB = ok(await admin.get(`/api/purchase-order/${s.poB._id}`));
  assert.equal((await user.post('/api/goods-receipt', { purchaseOrder: s.poB._id, lines: [{ poLine: poB.lines[0]._id, qty: 1 }] })).status, 403);

  // reorder
  ok(await admin.put('/api/reorder/rules', { rules: [
    { sku: s.sku._id, gudang: s.A._id, minQty: 100, maxQty: 200 },
    { sku: s.sku._id, gudang: s.B._id, minQty: 100, maxQty: 200 },
  ] }));
  const alerts = ok(await user.get('/api/reorder'));
  assert.deepEqual(alerts.map((r) => r.gudang.code), [s.A.code]);
  assert.equal(ok(await user.get('/api/reorder/summary')).monitored, 1);
  assert.equal((await user.put('/api/reorder/rules', { rules: [{ sku: s.sku._id, gudang: s.B._id, minQty: 1, maxQty: 2 }] })).status, 403);

  // dashboard
  const dash = ok(await user.get('/api/dashboard'));
  assert.deepEqual(dash.valueByGudang.map((g) => g.label), [s.A.code]);
  assert.equal(dash.openPo.count, 1);
});

test('allGudang users (default, incl. old users) see everything; admin assigns warehouses via /api/user', async () => {
  const admin = await t.loginAs();
  const s = await setup(admin);
  const all = await t.loginAs(FULL, 'Semua');
  assert.equal(ok(await all.get('/api/stock-adjustment')).totalData >= 2, true);
  assert.equal(ok(await all.get('/api/auth/me')).gudangAccess.all, true);

  const role = await t.model('Role').findOne({ name: { $ne: 'Super Admin' } }).lean();
  const created = ok(await admin.post('/api/user', {
    name: 'Gudang B', email: 'gb@test.com', password: 'secret123', role: role._id, allGudang: false, gudangs: [s.B._id],
  }), 201);
  let u = await t.model('User').findById(created._id).lean();
  assert.equal(u.allGudang, false);
  assert.deepEqual(u.gudangs.map(String), [s.B._id]);
  assert.equal((await admin.post('/api/user', {
    name: 'X', email: 'x@test.com', password: 'secret123', role: role._id, allGudang: false, gudangs: ['000000000000000000000000'],
  })).status, 400);

  ok(await admin.put(`/api/user/${created._id}`, { allGudang: false, gudangs: [s.A._id, s.B._id] }));
  const hist = ok(await admin.get('/api/audit-log/history', { entity: 'user', id: created._id }));
  assert.ok(hist.logs.some((l) => l.changes?.some((c) => c.field === 'gudangs')));

  // hapus gudang (tanpa histori) melepas penugasannya
  const C = ok(await admin.post('/api/gudang', { code: `${s.A.code}C`, name: 'Gudang C' }), 201);
  ok(await admin.put(`/api/user/${created._id}`, { allGudang: false, gudangs: [s.B._id, C._id] }));
  ok(await admin.del(`/api/gudang/${C._id}`));
  u = await t.model('User').findById(created._id).lean();
  assert.deepEqual(u.gudangs.map(String), [s.B._id]);
});
