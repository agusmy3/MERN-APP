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
    { subtotal: 230000, discountAmount: 30000, dpp: 200000, taxAmount: 22000, total: 222000, shippingCharge: 0, shippingDpp: 0, shippingTotal: 0 });
  assert.deepEqual(salesTotals(lines, { discountAmount: 30000, taxRate: '11', priceIncludesTax: true }),
    { subtotal: 230000, discountAmount: 30000, dpp: 180180.18, taxAmount: 19819.82, total: 200000, shippingCharge: 0, shippingDpp: 0, shippingTotal: 0 });
  // ongkir (sama dengan backend test/api/sales.test.js)
  assert.deepEqual(salesTotals(lines, { discountAmount: 30000, taxRate: 11, shippingCharge: '10000' }),
    { subtotal: 230000, discountAmount: 30000, dpp: 200000, taxAmount: 23100, total: 233100, shippingCharge: 10000, shippingDpp: 10000, shippingTotal: 11100 });
  assert.deepEqual(salesTotals(lines, { discountAmount: 30000, taxRate: 11, priceIncludesTax: true, shippingCharge: 11100 }),
    { subtotal: 230000, discountAmount: 30000, dpp: 180180.18, taxAmount: 20919.82, total: 211100, shippingCharge: 11100, shippingDpp: 10000, shippingTotal: 11100 });
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

test('POS shift report: X while open, Z with counted cash & difference after close', async () => {
  const { shiftReportHtml } = await import('../src/utils/receiptPrint.js');
  const base = { no: 'SHF-1', outlet: { name: 'Toko' }, cashier: { name: 'Kasir' }, openedAt: '2026-11-25T01:00:00Z', openingCash: 100000 };
  const summary = { salesCount: 2, salesTotal: 50000, byMethod: { CASH: 30000, QRIS: 20000 }, voidCount: 1, voidTotal: 5000, returnCount: 0, returnTotal: 0, cashIn: 0, cashOut: 0, expectedCash: 130000 };
  const x = shiftReportHtml({ ...base, status: 'OPEN' }, summary);
  assert.ok(x.includes('LAPORAN X'));
  assert.ok(x.includes('130.000'));
  assert.ok(x.includes('Void (1)'));
  const z = shiftReportHtml({ ...base, status: 'CLOSED', closedAt: '2026-11-25T09:00:00Z', expectedCash: 130000, closingCash: 129500, difference: -500 }, summary);
  assert.ok(z.includes('LAPORAN Z'));
  assert.ok(z.includes('129.500'));
  assert.ok(z.includes('-500'));
});

test('region helpers: postal code & coordinate pairs, address line', async () => {
  const { regionError, regionFrom } = await import('../src/utils/regionMeta.js');
  const { addressLine } = await import('../src/utils/salesMeta.js');
  assert.equal(regionError({ kodePos: '1234', latitude: '', longitude: '' }), 'Kode pos harus 5 digit.');
  assert.match(regionError({ kodePos: '', latitude: '-6.2', longitude: '' }), /latitude dan longitude/);
  assert.equal(regionError({ kodePos: '10310', latitude: '-6.2', longitude: '106.8' }), null);
  assert.deepEqual(regionFrom({ kota: 'Bandung', latitude: 0, longitude: null }),
    { provinsi: '', kota: 'Bandung', kecamatan: '', kodePos: '', latitude: '0', longitude: '' });
  assert.equal(addressLine({ alamat: 'Jl. Mawar 1', kecamatan: 'Menteng', kota: 'Jakarta Pusat', provinsi: 'DKI Jakarta', kodePos: '10310' }),
    'Jl. Mawar 1, Menteng, Jakarta Pusat, DKI Jakarta 10310');
  assert.equal(addressLine({ address: 'Jl. A' }), 'Jl. A');
});

test('delivery note html: no prices, escapes text, pickup vs delivery', async () => {
  const { deliveryNoteHtml } = await import('../src/utils/documentPrint.js');
  const base = {
    no: 'DO-202611-0001', date: '2026-11-25', status: 'POSTED', salesOrder: { no: 'SO-202611-0001', customerPoNo: 'PO<9>' },
    customer: { name: 'PT <Maju>' }, gudang: { code: 'MAIN', name: 'Gudang' },
    lines: [{ qty: 3, sku: { sku: 'KAOS-M' }, produk: { name: 'Kaos', uom: { code: 'PCS' } }, unitCost: 60000 }],
  };
  const html = deliveryNoteHtml({ ...base, deliveryMethod: 'DELIVERY', shipTo: { alamat: 'Jl. Mawar 1', kota: 'Bekasi' }, vehicleNo: 'B 1 CD' });
  assert.match(html, /SURAT JALAN/);
  assert.match(html, /PT &lt;Maju&gt;/);
  assert.match(html, /PO&lt;9&gt;/);
  assert.match(html, /Jl\. Mawar 1, Bekasi/);
  assert.match(html, /B 1 CD/);
  assert.doesNotMatch(html, /60[.,]?000/); // tanpa harga / HPP
  const pick = deliveryNoteHtml({ ...base, deliveryMethod: 'PICKUP', pickedUpBy: 'Andi' });
  assert.match(pick, /Diambil oleh/);
  assert.doesNotMatch(pick, /Kirim ke/);
});
