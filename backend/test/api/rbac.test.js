const { test } = require('node:test');
const assert = require('node:assert/strict');
const { useTestApp } = require('../helpers/setup');
const { ok } = require('../helpers/factory');

const t = useTestApp();

test('login: success & failure are audited, token works for /me', async () => {
  const admin = await t.loginAs('admin', 'Login Admin');
  const anon = t.anonymous();
  const good = await anon.post('/api/auth/login', { email: admin.user.email, password: 'secret123' });
  assert.equal(good.status, 200);
  const bad = await anon.post('/api/auth/login', { email: admin.user.email, password: 'wrong' });
  assert.equal(bad.status, 401);
  const logs = await t.model('AuditLog').find({ entity: 'auth', entityId: admin.user._id }).lean();
  assert.deepEqual(logs.map((l) => l.action).sort(), ['login', 'login_failed']);
  assert.equal(logs.find((l) => l.action === 'login_failed').meta.reason, 'wrong_password');
  const token = good.body.token || good.data?.token;
  const me = await t.request('GET', '/api/auth/me', token);
  assert.equal(me.status, 200);
});

test('no token -> 401, no permission -> 403, dropdown only needs login', async () => {
  assert.equal((await t.anonymous().get('/api/kategori')).status, 401);
  const viewer = await t.loginAs({ kategori: [] });
  assert.equal((await viewer.get('/api/kategori')).status, 200);
  const created = await viewer.post('/api/kategori', { name: 'X' });
  assert.equal(created.status, 403);
  assert.match(created.message, /permission to create Category/);
  assert.equal((await viewer.get('/api/vendor')).status, 403);
  assert.equal((await viewer.get('/api/vendor/dropdown')).status, 200);
});

test('role registry exposes per-resource actions', async () => {
  const admin = await t.loginAs();
  const { resources } = ok(await admin.get('/api/role/resources'));
  const byKey = Object.fromEntries(resources.map((r) => [r.key, r.actions]));
  assert.deepEqual(byKey.auditLog, ['view']);
  assert.ok(byKey.stockAdjustment.includes('post'));
  assert.deepEqual(byKey.produk, ['view', 'create', 'update', 'delete']);
});

test('role in use cannot be deleted; super admin cannot deactivate itself', async () => {
  const admin = await t.loginAs();
  const role = ok(await admin.post('/api/role', { name: 'Staff', permissions: [{ resource: 'produk', actions: ['view'] }] }), 201);
  ok(await admin.post('/api/user', { name: 'S', email: 'staff@test.com', password: 'secret123', role: role._id, isActive: true }), 201);
  const del = await admin.del(`/api/role/${role._id}`);
  assert.equal(del.status, 400);
  const self = await admin.put(`/api/user/${admin.user._id}`, { isActive: false });
  assert.equal(self.status, 400);
});

test('theme: any well-formed theme id is saved per user (palettes are defined in the frontend), bad ids rejected', async () => {
  const user = await t.loginAs({}, 'Tema');
  for (const theme of ['aurora', 'violet-sunset', 'ocean-coral']) {
    const res = await user.put('/api/auth/theme', { theme });
    assert.equal(res.status, 200);
    assert.equal(res.data.theme, theme);
  }
  for (const theme of ['', 'Aurora', 'x y', '<script>', 'a--b', 'x'.repeat(41), 12]) {
    assert.equal((await user.put('/api/auth/theme', { theme })).status, 400);
  }
  assert.equal(ok(await user.get('/api/auth/me')).theme, 'ocean-coral');
});
