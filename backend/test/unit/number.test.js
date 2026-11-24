const { test } = require('node:test');
const assert = require('node:assert/strict');
const { round2, hasMax2Decimals, checkAmount } = require('../../helpers/number');

test('round2 removes floating point noise', () => {
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(-2.255), -2.25);
  assert.equal(round2('12.345'), 12.35);
});

test('hasMax2Decimals', () => {
  assert.equal(hasMax2Decimals(12.34), true);
  assert.equal(hasMax2Decimals(12), true);
  assert.equal(hasMax2Decimals(12.345), false);
});

test('checkAmount validates required, number, decimals, min and nonZero', () => {
  assert.match(checkAmount('', 'Qty'), /required/);
  assert.match(checkAmount('abc', 'Qty'), /must be a number/);
  assert.match(checkAmount(1.555, 'Qty'), /2 decimal/);
  assert.match(checkAmount(-1, 'Qty'), />= 0/);
  assert.match(checkAmount(0, 'Qty', { min: 0, exclusive: true }), /> 0/);
  assert.match(checkAmount(0, 'Qty', { min: null, nonZero: true }), /cannot be 0/);
  assert.equal(checkAmount(-5.5, 'Qty', { min: null, nonZero: true }), null);
  assert.equal(checkAmount('10.25', 'Price'), null);
});
