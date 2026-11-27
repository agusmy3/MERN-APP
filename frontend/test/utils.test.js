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
    { provinsi: '', kota: 'Bandung', kecamatan: '', kelurahan: '', regionCode: '', kodePos: '', latitude: '0', longitude: '' });
  assert.equal(addressLine({ alamat: 'Jl. Mawar 1', kecamatan: 'Menteng', kota: 'Jakarta Pusat', provinsi: 'DKI Jakarta', kodePos: '10310' }),
    'Jl. Mawar 1, Menteng, Jakarta Pusat, DKI Jakarta 10310');
  assert.equal(addressLine({ address: 'Jl. A' }), 'Jl. A');
  assert.equal(addressLine({ alamat: 'Jl. Dago 1', kelurahan: 'Cipaganti', kecamatan: 'Coblong', kota: 'Kota Bandung', provinsi: 'Jawa Barat' }),
    'Jl. Dago 1, Cipaganti, Coblong, Kota Bandung, Jawa Barat');
});

test('region picker helpers: chain, pick level, legacy text, from path', async () => {
  const { regionChain, pickRegion, legacyRegionText, regionFromPath, EMPTY_REGION } = await import('../src/utils/regionMeta.js');
  assert.deepEqual(regionChain('32.73.02.1001'), ['32', '32.73', '32.73.02', '32.73.02.1001']);
  assert.deepEqual(regionChain(''), []);

  // data lama (teks tanpa kode) -> pilih provinsi: teks lama dibuang
  const legacy = { ...EMPTY_REGION, provinsi: 'Jabar', kota: 'Bandung', kodePos: '40100' };
  assert.deepEqual(legacyRegionText(legacy).map((x) => x.value), ['Jabar', 'Bandung']);
  let f = pickRegion(legacy, 0, { kode: '32', name: 'Jawa Barat' });
  assert.deepEqual([f.regionCode, f.provinsi, f.kota, f.kodePos], ['32', 'Jawa Barat', '', '40100']);
  f = pickRegion(f, 1, { kode: '32.73', name: 'Kota Bandung' });
  f = pickRegion(f, 2, { kode: '32.73.02', name: 'Coblong' });
  f = pickRegion(f, 3, { kode: '32.73.02.1001', name: 'Cipaganti', kodePos: '40131' });
  assert.deepEqual([f.regionCode, f.kelurahan, f.kodePos], ['32.73.02.1001', 'Cipaganti', '40131']);
  assert.equal(legacyRegionText(f).length, 0);
  // kosongkan kota -> kode kembali ke provinsi, tingkat di bawahnya kosong
  f = pickRegion(f, 1, null);
  assert.deepEqual([f.regionCode, f.provinsi, f.kota, f.kecamatan, f.kelurahan], ['32', 'Jawa Barat', '', '', '']);
  // hasil migrasi sebagian: kode sampai kota, teks kecamatan lama masih ada
  assert.deepEqual(legacyRegionText({ ...EMPTY_REGION, regionCode: '32.73', provinsi: 'Jawa Barat', kota: 'Kota Bandung', kecamatan: 'Tidak Ada' }),
    [{ label: 'District', value: 'Tidak Ada' }]);

  const p = regionFromPath(EMPTY_REGION, [
    { kode: '32', name: 'Jawa Barat' }, { kode: '32.73', name: 'Kota Bandung' }, { kode: '32.73.02', name: 'Coblong' },
  ]);
  assert.deepEqual([p.regionCode, p.provinsi, p.kecamatan, p.kelurahan], ['32.73.02', 'Jawa Barat', 'Coblong', '']);
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

test('documentPrint: company header, sales order & invoice with prices, totals and balance', async () => {
  const { salesOrderHtml, invoiceHtml, deliveryNoteHtml } = await import('../src/utils/documentPrint.js');
  const company = { 'company.name': 'PT Kita <Jaya>', 'company.address': 'Jl. A\nJakarta', 'company.npwp': '01.234', 'company.bankInfo': 'BCA 123 a.n. PT Kita' };
  const lines = [{ qty: 2, hargaJual: 100000, diskonPersen: 10, subtotal: 180000, sku: { sku: 'KAOS-M' }, produk: { name: 'Kaos', uom: { code: 'PCS' } } }];
  const so = {
    no: 'SO-1', date: '2026-11-25', status: 'OPEN', customer: { name: 'PT Maju', address: 'Jl. B', kota: 'Bogor', termDays: 30 },
    deliveryMethod: 'DELIVERY', shipTo: { name: 'Gudang Maju', alamat: 'Jl. C' }, lines,
    subtotal: 180000, discountAmount: 0, shippingCharge: 20000, dpp: 180000, shippingDpp: 20000, taxRate: 11, taxAmount: 22000, total: 222000,
  };
  const html = salesOrderHtml(so, company);
  assert.match(html, /PT Kita &lt;Jaya&gt;/);
  assert.match(html, /Jl\. A<br>Jakarta/);
  assert.match(html, /SALES ORDER/);
  assert.match(html, /Kirim ke/);
  assert.match(html, /30 hari/);
  assert.match(html, /200\.000/); // DPP barang + ongkir
  assert.match(html, /222\.000/);
  assert.doesNotMatch(html, /BCA 123/); // instruksi bayar hanya di invoice
  assert.doesNotMatch(salesOrderHtml(so, {}), /class="co"/); // tanpa nama perusahaan = tanpa kop

  const inv = { ...so, no: 'INV-1', status: 'POSTED', dueDate: '2026-12-25', paidAmount: 100000, returnedAmount: 0, paymentStatus: 'PARTIAL', deliveryOrders: [{ no: 'DO-1' }, { no: 'DO-2' }] };
  const ih = invoiceHtml(inv, company);
  assert.match(ih, /INVOICE/);
  assert.match(ih, /BCA 123/);
  assert.match(ih, /DO-1, DO-2/);
  assert.match(ih, /SISA TAGIHAN/);
  assert.match(ih, /122\.000/);
  assert.match(invoiceHtml({ ...inv, paidAmount: 222000, paymentStatus: 'PAID' }, company), /LUNAS/);
  assert.match(deliveryNoteHtml({ ...so, no: 'DO-1', status: 'POSTED' }, company), /PT Kita/);
});

test('documentPrint: quotation for a walk-in prospect with validity & terms', async () => {
  const { quotationHtml } = await import('../src/utils/documentPrint.js');
  const q = {
    no: 'QUO-1', date: '2026-11-20', validUntil: '2026-12-04', status: 'SENT', deliveryMethod: 'PICKUP',
    customer: { name: 'Umum / Walk-in', isWalkIn: true }, prospectName: 'Budi <B>', prospectContact: '0812', terms: 'DP 50%',
    lines: [{ qty: 1, hargaJual: 50000, subtotal: 50000, sku: { sku: 'X' }, produk: { name: 'X', uom: { code: 'PCS' } } }],
    subtotal: 50000, dpp: 50000, taxRate: 0, taxAmount: 0, total: 50000,
  };
  const html = quotationHtml(q, { 'company.name': 'PT Kita', 'company.bankInfo': 'BCA 1' });
  assert.match(html, /PENAWARAN HARGA/);
  assert.match(html, /Budi &lt;B&gt;/);
  assert.doesNotMatch(html, /Walk-in/);
  assert.match(html, /04 Dec 2026/);
  assert.match(html, /DP 50%/);
  assert.match(quotationHtml({ ...q, expired: true }), /KEDALUWARSA/);
});

test('allocateFreight (frontend copy) matches backend rules', async () => {
  const { allocateFreight } = await import('../src/utils/purchaseMeta.js');
  const out = allocateFreight([{ qtyBase: 24, baseUnitCost: 9000 }, { qtyBase: 6, baseUnitCost: 11000 }], 28200);
  assert.deepEqual(out.map((l) => [l.freightCost, l.unitCost]), [[21600, 9900], [6600, 12100]]);
  assert.deepEqual(allocateFreight([{ qtyBase: 1, baseUnitCost: 0 }, { qtyBase: 3, baseUnitCost: 0 }], 40).map((l) => l.freightCost), [10, 30]);
});

test('allocateFifo: oldest first, capped by balance; payment batch receipt print', async () => {
  const { allocateFifo } = await import('../src/utils/paymentMeta.js');
  const inv = [{ _id: 'a', balance: 500000 }, { _id: 'b', balance: 700000 }, { _id: 'c', balance: 300000 }];
  assert.deepEqual(allocateFifo(inv, 1000000), { a: 500000, b: 500000 });
  assert.deepEqual(allocateFifo(inv, '1500000.5'), { a: 500000, b: 700000, c: 300000 });
  assert.deepEqual(allocateFifo(inv, 0), {});
  const { paymentBatchHtml } = await import('../src/utils/documentPrint.js');
  const html = paymentBatchHtml({ no: 'RCV-1', date: '2026-11-26', method: 'TRANSFER', amount: 1000000, status: 'POSTED',
    allocations: [{ amount: 500000, salesInvoice: { no: 'INV-1', total: 500000 } }] },
  { 'company.name': 'PT Kita' }, { title: 'KUITANSI', partyHeading: 'Diterima dari', partyName: 'CV <A>', invoiceField: 'salesInvoice', methods: { TRANSFER: 'Transfer' } });
  assert.match(html, /KUITANSI/);
  assert.match(html, /CV &lt;A&gt;/);
  assert.match(html, /INV-1/);
  assert.match(html, /1\.000\.000/);
});

test('selling packages: line helpers & printed units', async () => {
  const { nextUnitFor, withUnit, payloadUnit, priceKey, baseQty, qtyText, selectableUnits } = await import('../src/utils/salesLines.js');
  const units = [{ uom: { _id: 'pcs', code: 'PCS' }, konversi: 1, price: 3500, isBase: true }, { uom: { _id: 'dus', code: 'DUS' }, konversi: 24, price: 78000 }];
  const s = { _id: 'sku1', units, matchedUom: 'dus' };
  assert.equal(nextUnitFor(s, []).uom.code, 'DUS'); // hasil scan barcode kemasan
  const line = { key: 'a', sku: { _id: 'sku1' }, uomId: 'dus', uomCode: 'DUS', baseCode: 'PCS', konversi: 24, units, qty: 2 };
  assert.equal(nextUnitFor({ ...s, matchedUom: null }, [line]).uom.code, 'PCS');
  assert.equal(nextUnitFor(s, [line, { ...line, key: 'b', uomId: 'pcs', konversi: 1 }]), null);
  assert.equal(baseQty(line), 48);
  assert.equal(payloadUnit(line), 'dus');
  assert.equal(priceKey(line), 'sku1:dus');
  assert.equal(priceKey({ ...line, uomId: 'pcs', konversi: 1 }), 'sku1:');
  assert.equal(withUnit(line, 'pcs').hargaJual, 3500);
  assert.equal(selectableUnits(line, [line, { ...line, key: 'b', uomId: 'pcs', konversi: 1 }]).length, 1);
  assert.equal(qtyText(2, line, String), '2 DUS (48 PCS)');
  const { salesLineSubtotal } = await import('../src/utils/salesMeta.js');
  assert.equal(salesLineSubtotal({ qty: 2, hargaJual: 78000 }), 156000);
  const { invoiceHtml } = await import('../src/utils/documentPrint.js');
  const html = invoiceHtml({ no: 'INV-9', status: 'POSTED', customer: { name: 'X' }, subtotal: 156000, total: 156000,
    lines: [{ qty: 48, qtyUom: 2, konversi: 24, uom: { code: 'DUS' }, hargaJual: 78000, subtotal: 156000, sku: { sku: 'AIR' }, produk: { name: 'Air', uom: { code: 'PCS' } } }] }, {});
  assert.match(html, />2<\/td>/);
  assert.match(html, /DUS <span class="m">\(48 PCS\)/);
});

test('receiptPrint: package lines show package qty and base content', async () => {
  const { receiptHtml } = await import('../src/utils/receiptPrint.js');
  const html = receiptHtml({
    no: 'POS-1', date: '2026-11-26T10:00:00', outlet: { name: 'Toko', receiptWidth: 58 }, customer: { name: 'Walk-in', isWalkIn: true },
    lines: [{ qty: 12, qtyUom: 2, konversi: 6, uom: { code: 'PAK' }, hargaJual: 22000, subtotal: 44000, produk: { name: 'Air', uom: { code: 'BTL' } }, sku: { sku: 'AIR' } }],
    subtotal: 44000, discountAmount: 0, dpp: 39639.64, taxAmount: 4360.36, taxRate: 11, priceIncludesTax: true, total: 44000, payments: [{ method: 'CASH', amount: 50000, type: 'PAYMENT' }], cashTendered: 50000, change: 6000,
  });
  assert.match(html, /2 PAK x 22\.000/);
  assert.match(html, /= 12 BTL/);
});

test('documentPrint: company logo in header (raster data URL only)', async () => {
  const { salesOrderHtml } = await import('../src/utils/documentPrint.js');
  const so = { no: 'SO-1', status: 'OPEN', customer: { name: 'X' }, lines: [], subtotal: 0, total: 0 };
  const logo = 'data:image/png;base64,iVBORw0KGgo=';
  assert.match(salesOrderHtml(so, { 'company.name': 'PT Kita', 'company.logo': logo }), /<img class="co-logo" src="data:image\/png;base64,iVBORw0KGgo="/);
  assert.match(salesOrderHtml(so, { 'company.logo': logo }), /co-logo/); // logo tanpa nama tetap tampil
  assert.doesNotMatch(salesOrderHtml(so, { 'company.name': 'PT', 'company.logo': 'javascript:alert(1)' }), /<img/);
});

test('themes: every theme in themes.js has a complete CSS block in index.css', async () => {
  const { THEMES, DEFAULT_THEME, isValidTheme } = await import('../src/theme/themes.js');
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  const required = [...css.matchAll(/--color-[a-z-]+:\s*var\((--t-[a-z-]+)\)/g)].map((m) => m[1]);
  assert.ok(required.length > 30);
  assert.equal(new Set(THEMES.map((t) => t.id)).size, THEMES.length);
  for (const t of THEMES) {
    const m = css.match(new RegExp(`\\[data-theme="${t.id}"\\]\\s*\\{([^}]*)\\}`));
    assert.ok(m, `CSS block for ${t.id}`);
    for (const v of required) assert.ok(m[1].includes(`${v}:`), `${t.id} defines ${v}`);
    assert.match(m[1], new RegExp(`color-scheme:\\s*${t.dark ? 'dark' : 'light'}`), `${t.id} color-scheme`);
  }
  assert.ok(isValidTheme('aurora') && isValidTheme(DEFAULT_THEME) && !isValidTheme('nope'));
  assert.equal(THEMES.length, 10);
});

test('map picker helpers: point parsing, rounding, initial view, geolocation errors', async () => {
  const { parsePoint, roundCoord, formatPoint, pickerView, INDONESIA_VIEW, geoErrorMessage } = await import('../src/utils/mapMeta.js');
  assert.deepEqual(parsePoint('-6.2', '106.8'), { lat: -6.2, lng: 106.8 });
  assert.equal(parsePoint('', '106.8'), null);
  assert.equal(parsePoint('abc', '1'), null);
  assert.equal(parsePoint('95', '1'), null);
  assert.deepEqual(parsePoint(0, 0), { lat: 0, lng: 0 });
  assert.equal(roundCoord(-6.123456789), -6.123457);
  assert.equal(formatPoint({ lat: -6.9, lng: 107.6 }), '-6.900000, 107.600000');
  assert.deepEqual(pickerView({ lat: -6.9, lng: 107.6 }, { lat: 1, lng: 2, level: 2 }), { lat: -6.9, lng: 107.6, zoom: 17 });
  assert.deepEqual(pickerView(null, { lat: -6.91, lng: 107.61, level: 2 }), { lat: -6.91, lng: 107.61, zoom: 13 });
  assert.equal(pickerView(null, { lat: -6.9, lng: 107.6, level: 1 }).zoom, 8);
  assert.deepEqual(pickerView(null, null), INDONESIA_VIEW);
  assert.match(geoErrorMessage(1), /Izin lokasi ditolak/);
  assert.match(geoErrorMessage(99), /Gagal/);
});
