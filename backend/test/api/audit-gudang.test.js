const { test } = require('node:test');
const assert = require('node:assert/strict');
const { useTestApp } = require('../helpers/setup');
const { ok, createMasters, createProduct, postAdjustment } = require('../helpers/factory');

const t = useTestApp();

test('audit log filtered by warehouse access: global list, history, dashboard; transfers visible to both sides; migration', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const other = ok(await admin.post('/api/gudang', { code: `B${Date.now() % 100000}`, name: 'Gudang B' }), 201);
  const sku = await createProduct(admin, m, `Audit ${Date.now()}`);
  const adjA = await postAdjustment(admin, m.gudang._id, [{ sku: sku._id, qtyChange: 10 }]);
  const adjB = await postAdjustment(admin, other._id, [{ sku: sku._id, qtyChange: 5 }]);
  const trf = ok(await admin.post('/api/stock-transfer', { fromGudang: m.gudang._id, toGudang: other._id, lines: [{ sku: sku._id, qty: 2 }] }), 201);

  const logA = await t.model('AuditLog').findOne({ entity: 'stockAdjustment', entityId: adjA._id }).lean();
  assert.deepEqual(logA.gudangs.map(String), [String(m.gudang._id)]);
  const logT = await t.model('AuditLog').findOne({ entity: 'stockTransfer', entityId: trf._id }).lean();
  assert.equal(logT.gudangs.length, 2);
  assert.equal((await t.model('AuditLog').findOne({ entity: 'kategori' }).lean()).gudangs, undefined); // master: tanpa gudang

  // user gudang B saja
  const userB = await t.loginAs({ auditLog: ['view'], stockAdjustment: ['view'], stockTransfer: ['view'], kategori: ['view'] }, 'Audit B', { gudangs: [other._id] });
  const list = ok(await userB.get('/api/audit-log?pageSize=100')).logs;
  const ids = new Set(list.map((l) => String(l.entityId)));
  assert.ok(ids.has(String(adjB._id)));
  assert.ok(!ids.has(String(adjA._id)));
  assert.ok(ids.has(String(trf._id)));                            // transfer ke gudang B
  assert.ok(list.some((l) => l.entity === 'kategori'));           // master data tetap terlihat
  assert.equal(ok(await userB.get(`/api/audit-log/history?entity=stockAdjustment&id=${adjA._id}`)).logs.length, 0);
  assert.ok(ok(await userB.get(`/api/audit-log/history?entity=stockAdjustment&id=${adjB._id}`)).logs.length > 0);
  const dash = ok(await userB.get('/api/dashboard'));
  assert.ok(!(dash.recentActivity || []).some((l) => String(l.entityId) === String(adjA._id)));

  // user semua gudang melihat semuanya
  const all = await t.loginAs({ auditLog: ['view'], stockAdjustment: ['view'] }, 'Audit All');
  assert.ok(ok(await all.get('/api/audit-log?entity=stockAdjustment&pageSize=100')).logs.some((l) => String(l.entityId) === String(adjA._id)));

  // migrasi log lama (tanpa gudangs) -> terisi dari dokumennya
  const col = t.model('AuditLog').collection;
  await col.updateMany({ entity: 'stockAdjustment' }, { $unset: { gudangs: '' } });
  assert.ok(ok(await userB.get('/api/audit-log?pageSize=100')).logs.some((l) => String(l.entityId) === String(adjA._id))); // belum dimigrasi
  const { migrateAuditGudang } = require('../../scripts/migrate-audit-gudang');
  assert.ok(await migrateAuditGudang() > 0);
  assert.ok(!ok(await userB.get('/api/audit-log?pageSize=100')).logs.some((l) => String(l.entityId) === String(adjA._id)));
  assert.equal(await migrateAuditGudang(), 0); // idempotent
});

test('company logo setting: raster data URL only, size limit, audit without the image content', async () => {
  const admin = await t.loginAs();
  const png = `data:image/png;base64,${Buffer.alloc(3000, 7).toString('base64')}`;
  assert.match((await admin.put('/api/setting', { values: { 'company.logo': 'data:image/svg+xml;base64,PHN2Zz4=' } })).message, /PNG, JPEG or WEBP/);
  assert.match((await admin.put('/api/setting', { values: { 'company.logo': 'https://example.com/logo.png' } })).message, /PNG, JPEG or WEBP/);
  const big = `data:image/jpeg;base64,${Buffer.alloc(210 * 1024, 1).toString('base64')}`;
  assert.match((await admin.put('/api/setting', { values: { 'company.logo': big } })).message, /200 KB/);
  ok(await admin.put('/api/setting', { values: { 'company.logo': png } }));
  assert.equal(ok(await admin.get('/api/setting')).values['company.logo'], png);
  const log = await t.model('AuditLog').findOne({ entity: 'setting', entityId: null, 'changes.to': /^\[image/ }).sort({ _id: -1 }).lean();
  assert.ok(log);
  assert.ok(!JSON.stringify(log).includes(png.slice(30, 200)));
  ok(await admin.put('/api/setting', { values: { 'company.logo': '' } }));
  assert.equal(ok(await admin.get('/api/setting')).values['company.logo'], '');
});
