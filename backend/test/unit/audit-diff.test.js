const { test } = require('node:test');
const assert = require('node:assert/strict');
const { diff } = require('../../helpers/auditLogger');

test('diff records only changed fields', () => {
  const changes = diff('kategori', { name: 'Kaos', deskripsi: 'a' }, { name: 'Kaos Polos', deskripsi: 'a' });
  assert.deepEqual(changes.map((c) => c.field), ['name']);
  assert.equal(changes[0].from, 'Kaos');
  assert.equal(changes[0].to, 'Kaos Polos');
});

test('list values: reorder is not a change, add/remove is', () => {
  assert.equal(diff('variant', { values: ['S', 'M'] }, { values: ['M', 'S'] }).length, 0);
  const changes = diff('variant', { values: ['S', 'M'] }, { values: ['S', 'L'] });
  assert.equal(changes[0].format, 'list');
});

test('permissions diffed per resource', () => {
  const changes = diff('role',
    { permissions: { produk: 'view' } },
    { permissions: { produk: 'view, update', kategori: 'view' } });
  assert.deepEqual(changes.map((c) => c.field).sort(), ['permissions.kategori', 'permissions.produk']);
});

test('secret fields are flagged without values', () => {
  const changes = diff('user', { name: 'A' }, { name: 'A' }, { rawBefore: { password: 'x' }, rawAfter: { password: 'y' } });
  assert.deepEqual(changes, [{ field: 'password', label: 'Password', format: 'secret', from: null, to: null }]);
});

test('empty to empty is not a change', () => {
  assert.equal(diff('kategori', { deskripsi: '' }, { deskripsi: null }).length, 0);
});
