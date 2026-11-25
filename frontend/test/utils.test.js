/**
 * Test fungsi utilitas frontend (murni, tanpa DOM): `npm test`.
 * Komponen React akan dites dengan Vitest + React Testing Library setelah dependensinya dipasang.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatRupiah, formatRupiahRange, formatNumber, formatSigned, round2, calcMargin, variantLabel, formatCompact, formatRupiahCompact,
} from '../src/utils/formatHelper.js';
import { lineSubtotal } from '../src/utils/purchaseMeta.js';
import { formatAuditValue, listDiff, groupByBatch, summarizeGroup } from '../src/utils/auditFormat.js';

// toLocaleString memakai non-breaking space untuk "Rp 12.500"
const norm = (s) => s.replace(/\s/g, ' ');

test('formatRupiah: no decimals for integers, max 2 otherwise, "-" for empty', () => {
  assert.equal(norm(formatRupiah(12500)), 'Rp 12.500');
  assert.equal(norm(formatRupiah(4166.666)), 'Rp 4.166,67');
  assert.equal(formatRupiah(null), '-');
  assert.equal(formatRupiah(''), '-');
  assert.equal(norm(formatRupiahRange(10000, 15000)), 'Rp 10.000 – Rp 15.000');
  assert.equal(norm(formatRupiahRange(10000, 10000)), 'Rp 10.000');
});

test('number helpers', () => {
  assert.equal(formatNumber(1234.567), '1.234,57');
  assert.equal(formatSigned(5), '+5');
  assert.equal(formatSigned(-2.25), '−2,25');
  assert.equal(formatSigned(0), '0');
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(calcMargin(100, 75), 25);
  assert.equal(calcMargin(0, 75), null);
  assert.equal(calcMargin(100, null), null);
  assert.equal(variantLabel({ variantValues: [{ value: 'Merah' }, { value: 'M' }] }), 'Merah / M');
  assert.equal(variantLabel({ variantValues: [] }), 'Default');
});

test('compact formatting for dashboard', () => {
  assert.equal(norm(formatCompact(1250000)), '1,25 jt');
  assert.equal(norm(formatRupiahCompact(7990)), 'Rp 7,99 rb');
});

test('PO line subtotal matches backend', () => {
  assert.equal(lineSubtotal({ qty: 10, hargaBeli: 120000, diskonPersen: 10 }), 1080000);
  assert.equal(lineSubtotal({ qty: '3', hargaBeli: '0.1' }), 0.3);
});

test('audit formatting helpers', () => {
  assert.equal(formatAuditValue({ format: 'bool' }, true), 'Yes');
  assert.equal(formatAuditValue({ format: 'secret' }, null), '••••••');
  assert.equal(formatAuditValue({ format: 'text' }, ''), null);
  assert.equal(formatAuditValue({ format: 'ref' }, { id: '1', text: 'Kaos' }), 'Kaos');
  assert.deepEqual(listDiff(['S', 'M'], ['M', 'L']), { added: ['L'], removed: ['S'] });

  const logs = [
    { _id: '1', batchId: 'b1', action: 'update', entity: 'produkSku' },
    { _id: '2', batchId: 'b1', action: 'update', entity: 'produkSku' },
    { _id: '3', batchId: null, action: 'create', entity: 'produk' },
  ];
  const groups = groupByBatch(logs);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].logs.length, 2);
  assert.match(summarizeGroup(groups[0].logs), /2 SKU/);
  assert.equal(summarizeGroup(groups[1].logs), 'Created Product');
});

test('UoM conversion rule: same type or package', async () => {
  const { canConvert } = await import('../src/utils/uomMeta.js');
  assert.equal(canConvert('WEIGHT', 'COUNT'), false);
  assert.equal(canConvert('PACK', 'COUNT'), true);
  assert.equal(canConvert('WEIGHT', 'WEIGHT'), true);
  assert.equal(canConvert('COUNT', 'PACK'), true);
  assert.equal(canConvert(null, 'COUNT'), true);
});

test('sales totals match backend (PPN exclusive / inclusive, document discount)', async () => {
  const { salesTotals, salesLineSubtotal } = await import('../src/utils/salesMeta.js');
  const lines = [{ qty: 2, hargaJual: 100000, diskonPersen: 10 }, { qty: '1', hargaJual: '50000' }];
  assert.equal(salesLineSubtotal(lines[0]), 180000);
  assert.deepEqual(salesTotals(lines, { discountAmount: 30000, taxRate: 11 }),
    { subtotal: 230000, discountAmount: 30000, dpp: 200000, taxAmount: 22000, total: 222000 });
  assert.deepEqual(salesTotals(lines, { discountAmount: 30000, taxRate: '11', priceIncludesTax: true }),
    { subtotal: 230000, discountAmount: 30000, dpp: 180180.18, taxAmount: 19819.82, total: 200000 });
});

test('POS receipt html: escapes text, shows totals, change and paper width', async () => {
  const { receiptHtml } = await import('../src/utils/receiptPrint.js');
  const html = receiptHtml({
    no: 'POS-202611-0001', date: '2026-11-25T10:00:00Z', outlet: { name: 'Toko <A>', receiptWidth: 80, receiptFooter: 'Terima kasih' },
    createdBy: { name: 'Kasir' }, customer: { name: 'Umum', isWalkIn: true },
    lines: [{ qty: 2, hargaJual: 11100, subtotal: 22200, produk: { name: 'Kopi' }, sku: { sku: 'KOPI', variantValues: [] } }],
    subtotal: 22200, total: 22200, taxRate: 11, taxAmount: 2200, priceIncludesTax: true,
    payments: [{ method: 'CASH', amount: 22200 }], cashTendered: 30000, change: 7800,
  });
  assert.ok(html.includes('Toko &lt;A&gt;'));
  assert.ok(html.includes('80mm'));
  assert.ok(html.includes('7.800'));
  assert.ok(html.includes('Terima kasih'));
});
