const { test } = require('node:test');
const assert = require('node:assert/strict');
const { useTestApp } = require('../helpers/setup');
const { ok, createMasters, createProduct, postAdjustment } = require('../helpers/factory');

const t = useTestApp();

/**
 * Database sendiri (angka pasti):
 * - INV A: SKU1 4 x 100.000, diskon dokumen 40.000, PPN 11% -> dpp 360.000, HPP 4 x 60.000
 * - INV B: SKU2 2 x 50.000 -> dpp 100.000, HPP 2 x 30.000
 * - retur INV A 1 x SKU1 -> net 90.000, HPP 60.000
 */
async function seed(admin) {
  const m = await createMasters(admin);
  const sku1 = await createProduct(admin, m, 'Laporan Satu');
  const sku2 = await createProduct(admin, m, 'Laporan Dua');
  await t.model('ProdukSku').updateOne({ _id: sku1._id }, { hargaJual: 100000 });
  await t.model('ProdukSku').updateOne({ _id: sku2._id }, { hargaJual: 50000 });
  await postAdjustment(admin, m.gudang._id, [{ sku: sku1._id, qtyChange: 10, unitCost: 60000 }, { sku: sku2._id, qtyChange: 10, unitCost: 30000 }], 'OPENING');
  const a = ok(await admin.post('/api/customer', { name: 'Alpha' }), 201);
  const b = ok(await admin.post('/api/customer', { name: 'Beta' }), 201);
  const invA = ok(await admin.post('/api/sales-invoice', { customer: a._id, gudang: m.gudang._id, discountAmount: 40000, lines: [{ sku: sku1._id, qty: 4, hargaJual: 100000 }] }), 201);
  const invB = ok(await admin.post('/api/sales-invoice', { customer: b._id, gudang: m.gudang._id, lines: [{ sku: sku2._id, qty: 2, hargaJual: 50000 }] }), 201);
  ok(await admin.post(`/api/sales-invoice/${invA._id}/post`));
  ok(await admin.post(`/api/sales-invoice/${invB._id}/post`));
  const r = ok(await admin.post('/api/sales-return', { salesInvoice: invA._id, reason: 'Cacat', lines: [{ sku: sku1._id, qty: 1 }] }), 201);
  ok(await admin.post(`/api/sales-return/${r._id}/post`));
  // draft tidak ikut laporan
  ok(await admin.post('/api/sales-invoice', { customer: b._id, gudang: m.gudang._id, lines: [{ sku: sku2._id, qty: 1, hargaJual: 1 }] }), 201);
  return { m, sku1, sku2, a, b, invA, invB };
}

test('sales report: net of returns, grouping, cost only with vendorPrice:view', async () => {
  const admin = await t.loginAs();
  const s = await seed(admin);
  const get = (q, user = admin) => user.get(`/api/sales-report/sales?tz=Asia/Jakarta&${q}`);

  const byDay = ok(await get('groupBy=day'));
  assert.deepEqual(byDay.totals, { sales: 460000, returns: 90000, net: 370000, invoiceCount: 2, shipping: 0, writeOff: 0, badDebt: 0, cogs: 240000, grossProfit: 130000, margin: 35.14 });
  assert.equal(byDay.rows.length, 1);

  const byCustomer = ok(await get('groupBy=customer'));
  const alpha = byCustomer.rows.find((r) => r.key === s.a._id);
  assert.equal(alpha.label, 'Alpha');
  assert.equal(alpha.sales, 360000);
  assert.equal(alpha.returns, 90000);
  assert.equal(alpha.net, 270000);
  assert.equal(alpha.cogs, 180000);
  assert.equal(alpha.invoiceCount, 1);
  assert.equal(byCustomer.rows[0].key, s.a._id); // urut net terbesar

  const bySku = ok(await get('groupBy=sku'));
  const one = bySku.rows.find((r) => r.key === s.sku1._id);
  assert.equal(one.qty, 3);
  assert.equal(one.net, 270000);
  assert.equal(one.label, s.sku1.sku);

  const byKategori = ok(await get('groupBy=kategori'));
  assert.equal(byKategori.rows.length, 1);
  assert.equal(byKategori.rows[0].net, 370000);

  const onlyB = ok(await get(`groupBy=produk&customer=${s.b._id}`));
  assert.equal(onlyB.totals.net, 100000);

  // periode tanpa data
  assert.equal(ok(await get('groupBy=day&from=2020-01-01&to=2020-01-31')).rows.length, 0);
  assert.equal((await get('from=2025-02-01&to=2025-01-01')).status, 400);

  const clerk = await t.loginAs({ salesReport: [] });
  const noCost = ok(await get('groupBy=customer', clerk));
  assert.equal(noCost.totals.cogs, undefined);
  assert.equal(noCost.rows[0].grossProfit, undefined);
  const none = await t.loginAs({ salesInvoice: [] });
  assert.equal((await get('groupBy=day', none)).status, 403);
});

test('aging: open balances bucketed by days overdue per customer', async () => {
  const admin = await t.loginAs();
  const s = await seed(admin);
  // INV B: bayar 11.000 (sisa 100.000), jatuh tempo 40 hari lalu
  ok(await admin.post('/api/sales-payment', { salesInvoice: s.invB._id, method: 'CASH', amount: 11000 }), 201);
  await t.model('SalesInvoice').updateOne({ _id: s.invB._id }, { dueDate: new Date(Date.now() - 40 * 86400000) });

  const aging = ok(await admin.get('/api/sales-report/aging'));
  const rowA = aging.rows.find((r) => r.customer._id === s.a._id);
  const rowB = aging.rows.find((r) => r.customer._id === s.b._id);
  assert.equal(rowA.current, 399600 - 99900);
  assert.equal(rowB.d31_60, 100000);
  assert.equal(rowB.invoices[0].daysOverdue, 40);
  assert.equal(aging.rows[0].customer._id, s.b._id); // yang lewat jatuh tempo di atas
  assert.ok(aging.totals.total >= 399700);

  // lunas -> keluar dari aging
  ok(await admin.post('/api/sales-payment', { salesInvoice: s.invB._id, method: 'CASH', amount: 100000 }), 201);
  const after = ok(await admin.get('/api/sales-report/aging'));
  assert.ok(!after.rows.some((r) => r.customer._id === s.b._id));
});
