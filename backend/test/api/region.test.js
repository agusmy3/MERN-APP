const { test } = require('node:test');
const assert = require('node:assert/strict');
const { useTestApp } = require('../helpers/setup');
const { ok } = require('../helpers/factory');
const { importRegions } = require('../../helpers/regionHelper');

const t = useTestApp();

test('region master: import is idempotent, retires missing codes, cascading list, search, detail with center', async () => {
  const first = await importRegions();
  assert.ok(first.total > 90000);
  assert.equal(first.added, first.total);
  assert.deepEqual(await importRegions(), { total: first.total, added: 0, updated: 0, retired: 0 });

  // kode yang tidak ada lagi di data -> nonaktif, tidak dihapus; nilai yang diubah manual dikembalikan
  const Region = t.model('Region');
  await Region.create({ _id: '32.73.99', level: 3, name: 'Kecamatan Lama', parent: '32.73' });
  await Region.updateOne({ _id: '32.73.02' }, { $set: { name: 'Diubah' } });
  assert.deepEqual(await importRegions(), { total: first.total, added: 0, updated: 1, retired: 1 });
  assert.equal((await Region.findById('32.73.99').lean()).isActive, false);
  assert.equal((await Region.findById('32.73.02').lean()).name, 'Coblong');

  const user = await t.loginAs({}, 'Region Reader'); // cukup login, tanpa izin apa pun
  assert.equal((await fetch(`${t.baseUrl}/api/region`)).status, 401);

  const provinces = ok(await user.get('/api/region'));
  assert.equal(provinces.length, 38);
  assert.ok(provinces.some((p) => p.kode === '32' && p.name === 'Jawa Barat' && p.level === 1));
  const cities = ok(await user.get('/api/region?parent=32'));
  assert.ok(cities.every((c) => c.parent === '32' && c.level === 2));
  assert.ok(ok(await user.get('/api/region?parent=32&search=bandung')).some((c) => c.kode === '32.73'));
  const districts = ok(await user.get('/api/region?parent=32.73'));
  assert.ok(districts.some((d) => d.name === 'Coblong'));
  assert.ok(!districts.some((d) => d.kode === '32.73.99'));        // nonaktif tidak ditawarkan
  const villages = ok(await user.get('/api/region?parent=32.73.02'));
  const cipaganti = villages.find((v) => v.kode === '32.73.02.1001');
  assert.equal(cipaganti.kodePos, '40131');
  assert.equal((await user.get('/api/region?parent=abc')).status, 400);

  const hits = ok(await user.get('/api/region/search?q=cipaganti&level=4'));
  assert.ok(hits.some((h) => h.kode === '32.73.02.1001' && h.path === 'Cipaganti, Coblong, Kota Bandung, Jawa Barat'));
  const starts = ok(await user.get('/api/region/search?q=kota bandung'));
  assert.equal(starts[0].kode, '32.73');
  assert.equal((await user.get('/api/region/search?q=ab')).status, 400);

  const detail = ok(await user.get('/api/region/32.73.02.1001'));
  assert.deepEqual(detail.path.map((p) => p.kode), ['32', '32.73', '32.73.02', '32.73.02.1001']);
  assert.equal(detail.center.level, 2);                             // koordinat hanya sampai kab/kota
  assert.ok(Math.abs(detail.center.lat - -6.91) < 0.1 && Math.abs(detail.center.lng - 107.61) < 0.1);
  assert.equal((await user.get('/api/region/32.73.02.9999')).status, 404);
  assert.equal((await user.get('/api/region/x1')).status, 400);
});
