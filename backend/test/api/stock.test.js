const { test } = require('node:test');
const assert = require('node:assert/strict');
const { useTestApp } = require('../helpers/setup');
const { ok, createMasters, createProduct, postAdjustment } = require('../helpers/factory');

const t = useTestApp();
const skuDoc = (id) => t.model('ProdukSku').findById(id).lean();
const balance = async (sku, gudang) => (await t.model('StockBalance').findOne({ sku, gudang }).lean())?.qty ?? 0;

test('adjustment: draft does not change stock; post creates movements; posted doc is locked', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const a = await createProduct(admin, m, 'Kaos A');
  const b = await createProduct(admin, m, 'Topi B');

  const draft = ok(await admin.post('/api/stock-adjustment', {
    type: 'ADJUSTMENT', gudang: m.gudang._id, reason: 'CORRECTION',
    lines: [{ sku: a._id, qtyChange: 10.5 }, { sku: b._id, qtyChange: 3 }],
  }), 201);
  assert.match(draft.no, /^ADJ-\d{6}-\d{4}$/);
  assert.equal((await skuDoc(a._id)).stok, 0);

  ok(await admin.post(`/api/stock-adjustment/${draft._id}/post`));
  assert.equal((await skuDoc(a._id)).stok, 10.5);
  assert.equal(await balance(a._id, m.gudang._id), 10.5);
  const mv = await t.model('StockMovement').find({ refId: draft._id }).lean();
  assert.equal(mv.length, 2);
  assert.ok(mv.every((x) => x.refNo === draft.no));

  for (const res of [
    await admin.put(`/api/stock-adjustment/${draft._id}`, { gudang: m.gudang._id, reason: 'DAMAGED', lines: [{ sku: a._id, qtyChange: 1 }] }),
    await admin.del(`/api/stock-adjustment/${draft._id}`),
    await admin.post(`/api/stock-adjustment/${draft._id}/post`),
  ]) assert.equal(res.status, 400);
});

test('validation: reason OTHER needs note, max 2 decimals, unique SKU, no future date', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const a = await createProduct(admin, m, 'Validasi');
  const base = { type: 'ADJUSTMENT', gudang: m.gudang._id, reason: 'DAMAGED' };
  const cases = [
    { ...base, reason: 'OTHER', lines: [{ sku: a._id, qtyChange: 1 }] },
    { ...base, lines: [{ sku: a._id, qtyChange: 1.555 }] },
    { ...base, lines: [{ sku: a._id, qtyChange: 1 }, { sku: a._id, qtyChange: 2 }] },
    { ...base, lines: [] },
    { ...base, date: '2999-01-01', lines: [{ sku: a._id, qtyChange: 1 }] },
  ];
  for (const body of cases) assert.equal((await admin.post('/api/stock-adjustment', body)).status, 400);
});

test('negative stock rejects the whole document', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const a = await createProduct(admin, m, 'Neg A');
  const b = await createProduct(admin, m, 'Neg B');
  await postAdjustment(admin, m.gudang._id, [{ sku: a._id, qtyChange: 5 }, { sku: b._id, qtyChange: 5 }]);
  const doc = ok(await admin.post('/api/stock-adjustment', {
    type: 'ADJUSTMENT', gudang: m.gudang._id, reason: 'LOST', lines: [{ sku: b._id, qtyChange: -1 }, { sku: a._id, qtyChange: -20 }],
  }), 201);
  const res = await admin.post(`/api/stock-adjustment/${doc._id}/post`);
  assert.equal(res.status, 400);
  assert.match(res.message, /cannot be reduced/);
  assert.equal((await skuDoc(b._id)).stok, 5);
});

test('opname uses system stock at post; cancel creates reversal', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const a = await createProduct(admin, m, 'Opname A');
  await postAdjustment(admin, m.gudang._id, [{ sku: a._id, qtyChange: 10.5 }]);
  const op = ok(await admin.post('/api/stock-adjustment', {
    type: 'OPNAME', gudang: m.gudang._id, reason: 'DAMAGED', lines: [{ sku: a._id, qtyActual: 8.25 }],
  }), 201);
  assert.equal(op.reason, 'OPNAME');
  assert.match(op.no, /^OPN-/);
  const posted = ok(await admin.post(`/api/stock-adjustment/${op._id}/post`));
  assert.equal(posted.lines[0].qtySystem, 10.5);
  assert.equal(posted.lines[0].qtyChange, -2.25);
  assert.equal((await skuDoc(a._id)).stok, 8.25);

  assert.equal((await admin.post(`/api/stock-adjustment/${op._id}/cancel`, {})).status, 400); // alasan wajib
  ok(await admin.post(`/api/stock-adjustment/${op._id}/cancel`, { reason: 'hitung ulang' }));
  assert.equal((await skuDoc(a._id)).stok, 10.5);
  const rev = await t.model('StockMovement').findOne({ refId: op._id, isReversal: true }).lean();
  assert.equal(rev.qty, 2.25);
});

test('multi warehouse: balance per warehouse, SKU total = sum; inactive warehouse blocked', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const g2 = ok(await admin.post('/api/gudang', { code: 'JKT-T', name: 'Jakarta' }), 201);
  const a = await createProduct(admin, m, 'Multi');
  await postAdjustment(admin, m.gudang._id, [{ sku: a._id, qtyChange: 4 }]);
  await postAdjustment(admin, g2._id, [{ sku: a._id, qtyChange: 0.1 }]);
  await postAdjustment(admin, g2._id, [{ sku: a._id, qtyChange: 0.2 }]);
  assert.equal(await balance(a._id, g2._id), 0.3);
  assert.equal((await skuDoc(a._id)).stok, 4.3);

  assert.equal((await admin.del(`/api/gudang/${g2._id}`)).status, 400);
  ok(await admin.put(`/api/gudang/${g2._id}`, { isActive: false }));
  const res = await admin.post('/api/stock-adjustment', { type: 'ADJUSTMENT', gudang: g2._id, reason: 'DAMAGED', lines: [{ sku: a._id, qtyChange: -1 }] });
  assert.equal(res.status, 400);
  assert.match(res.message, /inactive/);
});

test('SKU stock is read-only; SKU/product with stock history cannot be deleted', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const a = await createProduct(admin, m, 'ReadOnly');
  await postAdjustment(admin, m.gudang._id, [{ sku: a._id, qtyChange: 7 }]);
  ok(await admin.put(`/api/produk/${a.produk._id}/sku`, { skus: [{ _id: a._id, sku: a.sku, hargaJual: 1500.55, stok: 999, isActive: true }] }));
  const after = await skuDoc(a._id);
  assert.equal(after.stok, 7);
  assert.equal(after.hargaJual, 1500.55);
  assert.equal((await admin.put(`/api/produk/${a.produk._id}/sku`, { skus: [{ _id: a._id, sku: a.sku, hargaJual: 1.005 }] })).status, 400);
  assert.equal((await admin.del(`/api/produk/${a.produk._id}/sku/${a._id}`)).status, 400);
  assert.equal((await admin.del(`/api/produk/${a.produk._id}`)).status, 400);

  const free = await createProduct(admin, m, 'Bebas');
  ok(await admin.del(`/api/produk/${free.produk._id}`));
});

test('stock movements are append-only', async () => {
  await assert.rejects(t.model('StockMovement').updateOne({}, { qty: 1 }), /immutable/);
  await assert.rejects(t.model('StockMovement').deleteMany({}), /immutable/);
});

test('permission split: draft creator cannot post', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const a = await createProduct(admin, m, 'Split');
  const clerk = await t.loginAs({ stockAdjustment: ['create', 'update'] });
  const doc = ok(await clerk.post('/api/stock-adjustment', { type: 'ADJUSTMENT', gudang: m.gudang._id, reason: 'OPENING', lines: [{ sku: a._id, qtyChange: 1, unitCost: 10 }] }), 201);
  assert.equal((await clerk.post(`/api/stock-adjustment/${doc._id}/post`)).status, 403);
  assert.equal((await clerk.del(`/api/stock-adjustment/${doc._id}`)).status, 403);
});
