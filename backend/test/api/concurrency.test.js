/**
 * Transaksi & konkurensi: rollback bila audit gagal, dan aturan lintas dokumen di bawah request bersamaan.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { useTestApp } = require('../helpers/setup');
const { ok, createMasters, createProduct, postAdjustment } = require('../helpers/factory');

const t = useTestApp();

test('audit failure rolls back the whole write (product + SKU)', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const AuditLog = t.model('AuditLog');
  const original = AuditLog.insertMany.bind(AuditLog);
  AuditLog.insertMany = async (docs) => {
    if (docs.some((d) => d.entity === 'produkSku')) throw new Error('simulated audit failure');
    return original(docs);
  };
  try {
    const res = await admin.post('/api/produk', { name: 'Rollback', kategori: m.kategori._id, uom: m.pcs._id, variants: [] });
    assert.equal(res.status, 500);
  } finally {
    AuditLog.insertMany = original;
  }
  assert.equal(await t.model('Produk').countDocuments({ name: 'Rollback' }), 0);
  assert.equal(await AuditLog.countDocuments({ entityLabel: 'Rollback' }), 0);
});

test('concurrent posts never overdraw stock', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const a = await createProduct(admin, m, 'Race');
  await postAdjustment(admin, m.gudang._id, [{ sku: a._id, qtyChange: 10 }]);
  for (let round = 0; round < 3; round++) {
    const docs = await Promise.all([1, 2].map(async () => ok(await admin.post('/api/stock-adjustment', {
      type: 'ADJUSTMENT', gudang: m.gudang._id, reason: 'LOST', lines: [{ sku: a._id, qtyChange: -6 }],
    }), 201)));
    const res = await Promise.all(docs.map((d) => admin.post(`/api/stock-adjustment/${d._id}/post`)));
    assert.equal(res.filter((r) => r.status === 200).length, 1, `round ${round}`);
    assert.equal((await t.model('ProdukSku').findById(a._id).lean()).stok, 4);
    await postAdjustment(admin, m.gudang._id, [{ sku: a._id, qtyChange: 6 }]);
    for (const d of docs) await admin.del(`/api/stock-adjustment/${d._id}`);
  }
});

test('same document posted twice concurrently is applied once', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const a = await createProduct(admin, m, 'Twice');
  const doc = ok(await admin.post('/api/stock-adjustment', { type: 'ADJUSTMENT', gudang: m.gudang._id, reason: 'CORRECTION', lines: [{ sku: a._id, qtyChange: 1 }] }), 201);
  const res = await Promise.all([1, 2].map(() => admin.post(`/api/stock-adjustment/${doc._id}/post`)));
  assert.equal(res.filter((r) => r.status === 200).length, 1);
  assert.equal(await t.model('StockMovement').countDocuments({ refId: doc._id }), 1);
});

test('two goods receipts for the last outstanding qty: only one posts', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const a = await createProduct(admin, m, 'GR Race');
  const po = ok(await admin.post('/api/purchase-order', {
    vendor: m.vendor._id, gudang: m.gudang._id, issue: true,
    lines: [{ sku: a._id, uomBeli: m.pcs._id, konversi: 1, qty: 5, hargaBeli: 100 }],
  }), 201);
  const grs = await Promise.all([1, 2].map(async () => ok(await admin.post('/api/goods-receipt', {
    purchaseOrder: po._id, lines: [{ poLine: po.lines[0]._id, qty: 4 }],
  }), 201)));
  const res = await Promise.all(grs.map((g) => admin.post(`/api/goods-receipt/${g._id}/post`)));
  assert.equal(res.filter((r) => r.status === 200).length, 1);
  assert.equal((await t.model('PurchaseOrder').findById(po._id).lean()).lines[0].qtyReceived, 4);
});

test('two vendors made preferred at the same time: exactly one stays preferred', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const a = await createProduct(admin, m, 'Preferred Race');
  const v2 = ok(await admin.post('/api/vendor', { companyName: 'Vendor B', picName: 'x', picContact: 'x', companyAddress: 'x' }), 201);
  for (const v of [m.vendor, v2]) {
    ok(await admin.post('/api/vendor-price', { vendor: v._id, skus: [a._id], uomBeli: m.pcs._id, konversi: 1, hargaBeli: 100 }), 201);
  }
  const prices = await t.model('VendorPrice').find({ sku: a._id }).lean();
  await Promise.all(prices.map((p) => admin.put(`/api/vendor-price/${p._id}`, { isPreferred: true })));
  assert.equal(await t.model('VendorPrice').countDocuments({ sku: a._id, isPreferred: true }), 1);
});

test('two super admins deactivating each other: at least one stays active', async () => {
  const a1 = await t.loginAs('admin', 'SA One');
  const a2 = await t.loginAs('admin', 'SA Two');
  const User = t.model('User');
  // hanya 2 Super Admin aktif untuk test ini
  await User.updateMany({ _id: { $nin: [a1.user._id, a2.user._id] } }, { isActive: false });
  await Promise.all([
    a1.put(`/api/user/${a2.user._id}`, { isActive: false }),
    a2.put(`/api/user/${a1.user._id}`, { isActive: false }),
  ]);
  const role = await t.model('Role').findOne({ isSystem: true });
  assert.ok((await User.countDocuments({ role: role._id, isActive: true })) >= 1);
});
