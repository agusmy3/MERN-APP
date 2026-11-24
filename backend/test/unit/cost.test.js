const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nextAvgCost } = require('../../helpers/stockHelper');
const { lineSubtotal, poTotals, unitCostOf, outstandingOf, receiptStatus } = require('../../helpers/purchaseHelper');

test('nextAvgCost: moving weighted average', () => {
  assert.equal(nextAvgCost(48, 9000, 12, 11000), 9400);          // (48x9000 + 12x11000) / 60
  assert.equal(nextAvgCost(0, 9000, 10, 12000), 12000);          // stok kosong -> harga masuk
  assert.equal(nextAvgCost(10, null, 5, 7000), 7000);            // HPP belum ada -> harga masuk
  assert.equal(nextAvgCost(50, 9400, -12, 11000), 8894.74);      // pembalik GR
  assert.equal(nextAvgCost(12, 9400, -12, 11000), 9400);         // stok habis setelah pembalik -> tetap
});

test('PO line subtotal & totals', () => {
  assert.equal(lineSubtotal({ qty: 10, hargaBeli: 120000, diskonPersen: 10 }), 1080000);
  assert.equal(lineSubtotal({ qty: 3, hargaBeli: 0.1 }), 0.3);
  assert.deepEqual(poTotals([{ subtotal: 1080000 }, { subtotal: 132000 }], 11), { subtotal: 1212000, taxAmount: 133320, total: 1345320 });
  assert.deepEqual(poTotals([{ subtotal: 100 }], 0), { subtotal: 100, taxAmount: 0, total: 100 });
});

test('unit cost per base unit: PKP excludes PPN, non-PKP includes it', () => {
  const line = { hargaBeli: 120000, diskonPersen: 10, konversi: 12 };
  assert.equal(unitCostOf({ isPKP: true, taxRate: 11 }, line), 9000);
  assert.equal(unitCostOf({ isPKP: false, taxRate: 11 }, line), 9990);
});

test('outstanding & receipt status', () => {
  assert.equal(outstandingOf({ qty: 10, qtyReceived: 4 }), 6);
  assert.equal(outstandingOf({ qty: 10, qtyReceived: 12 }), 0);
  assert.equal(receiptStatus([{ qty: 10, qtyReceived: 0 }]), 'OPEN');
  assert.equal(receiptStatus([{ qty: 10, qtyReceived: 4 }, { qty: 1, qtyReceived: 0 }]), 'PARTIAL');
  assert.equal(receiptStatus([{ qty: 10, qtyReceived: 10 }]), 'RECEIVED');
});
