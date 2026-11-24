const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePermissions, hasPermission, getEffectivePermissions, getResourceRegistry, allowedActions,
} = require('../../config/permissions');

test('normalizePermissions adds view, drops unknown resources/actions, keeps registry order', () => {
  const result = normalizePermissions([
    { resource: 'produk', actions: ['update', 'post', 'bogus'] },
    { resource: 'unknown', actions: ['view'] },
    { resource: 'kategori', actions: ['view'] },
    { resource: 'stockAdjustment', actions: ['post'] },
  ]);
  assert.deepEqual(result, [
    { resource: 'kategori', actions: ['view'] },
    { resource: 'produk', actions: ['view', 'update'] },
    { resource: 'stockAdjustment', actions: ['view', 'post'] },
  ]);
});

test('resources may restrict or extend actions', () => {
  assert.deepEqual(allowedActions('auditLog'), ['view']);
  assert.ok(allowedActions('goodsReceipt').includes('post'));
  assert.ok(!allowedActions('produk').includes('post'));
  const registry = getResourceRegistry();
  assert.ok(registry.every((r) => Array.isArray(r.actions) && r.actions.includes('view')));
});

test('hasPermission requires view and an allowed action', () => {
  const user = { role: { permissions: [{ resource: 'produk', actions: ['view', 'update'] }, { resource: 'vendor', actions: ['update'] }] } };
  assert.equal(hasPermission(user, 'produk', 'update'), true);
  assert.equal(hasPermission(user, 'produk', 'delete'), false);
  assert.equal(hasPermission(user, 'vendor', 'update'), false); // tanpa view
  assert.equal(hasPermission({ role: { isSystem: true } }, 'anything', 'delete'), true);
  assert.equal(hasPermission({ role: null }, 'produk', 'view'), false);
});

test('effective permissions for Super Admin follow each resource registry', () => {
  const eff = getEffectivePermissions({ isSystem: true });
  assert.deepEqual(eff.auditLog, ['view']);
  assert.ok(eff.stockAdjustment.includes('post'));
  assert.ok(!eff.produk.includes('post'));
});
