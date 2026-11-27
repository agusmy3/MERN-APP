const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readRegionFile, CODE_RX, parentOf, ancestorCodes, levelOf } = require('../../helpers/regionHelper');

test('region data file: valid codes, unique, every parent exists, postal codes & coordinates', () => {
  const { rows, count, source } = readRegionFile();
  assert.match(source, /cahyadsn/);
  assert.equal(rows.length, count);
  const codes = new Set();
  const levels = [0, 0, 0, 0, 0];
  for (const [kode, name, lat, lng, kodePos] of rows) {
    assert.match(kode, CODE_RX, kode);
    assert.ok(name && name.trim() === name, kode);
    assert.ok(!codes.has(kode), `duplicate ${kode}`);
    codes.add(kode);
    levels[levelOf(kode)] += 1;
    if (lat != null) assert.ok(lat >= -11 && lat <= 6 && lng >= 94 && lng <= 142, `coordinate ${kode}`);
    if (kodePos != null) assert.match(kodePos, /^\d{5}$/);
  }
  for (const kode of codes) {
    const p = parentOf(kode);
    if (p) assert.ok(codes.has(p), `parent of ${kode}`);
  }
  assert.equal(levels[1], 38);
  assert.ok(levels[2] > 500 && levels[3] > 7000 && levels[4] > 80000);
  assert.deepEqual(ancestorCodes('32.73.02.1001'), ['32', '32.73', '32.73.02', '32.73.02.1001']);
});
