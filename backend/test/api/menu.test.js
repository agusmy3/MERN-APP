const { test } = require('node:test');
const assert = require('node:assert/strict');
const { useTestApp } = require('../helpers/setup');
const { ok } = require('../helpers/factory');

const t = useTestApp();

test('menu tree sorted by order then name; order must be an integer', async () => {
  const admin = await t.loginAs();
  const zeta = ok(await admin.post('/api/menu', { menu: 'Zeta', component: '/zeta', order: 1 }), 201);
  ok(await admin.post('/api/menu', { menu: 'Alpha', component: '/alpha' }), 201);
  ok(await admin.post('/api/menu', { menu: 'Beta', component: '/beta', order: 2 }), 201);
  assert.equal((await admin.post('/api/menu', { menu: 'Bad', order: 1.5 })).status, 400);
  const tree = ok(await admin.get('/api/menu/tree'));
  assert.deepEqual(tree.map((x) => x.menu), ['Zeta', 'Beta', 'Alpha']);
  ok(await admin.put(`/api/menu/${zeta._id}`, { menu: 'Zeta', component: '/zeta', order: 9 }));
  assert.deepEqual(ok(await admin.get('/api/menu/tree')).map((x) => x.menu), ['Beta', 'Zeta', 'Alpha']);
});

test('sidebar tree is filtered by permission; menu with sub-menus cannot be deleted', async () => {
  const admin = await t.loginAs();
  const group = ok(await admin.post('/api/menu', { menu: 'Master Data', order: 1 }), 201);
  ok(await admin.post('/api/menu', { menu: 'Category', component: '/kategori', resource: 'kategori', parent_id: group._id }), 201);
  ok(await admin.post('/api/menu', { menu: 'Vendor', component: '/vendor', resource: 'vendor', parent_id: group._id }), 201);
  const viewer = await t.loginAs({ kategori: [] });
  const tree = ok(await viewer.get('/api/menu/tree'));
  const master = tree.find((x) => x.menu === 'Master Data');
  assert.deepEqual(master.children.map((c) => c.menu), ['Category']);
  assert.equal((await admin.del(`/api/menu/${group._id}`)).status, 400);
});
