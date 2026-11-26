const { test } = require('node:test');
const assert = require('node:assert/strict');
const { useTestApp } = require('../helpers/setup');
const { ok, createMasters, createProduct, postAdjustment } = require('../helpers/factory');

const t = useTestApp();
const balanceOf = async (sku, gudang) => (await t.model('StockBalance').findOne({ sku, gudang }).lean())?.qty ?? 0;

/** Air: BTL @4.000 (HPP 2.500, stok 60), PAK isi 6 @22.000 (barcode), DUS isi 24 (harga kosong = 96.000); kasir + supervisor */
async function setup(admin) {
  const m = await createMasters(admin);
  const pak = ok(await admin.post('/api/uom', { code: `PK${Date.now() % 100000}`, name: 'Pak', type: 'PACK' }), 201);
  const sku = await createProduct(admin, m, `POS Pak ${Date.now()}`);
  const barcode = `BTL${Date.now()}`;
  const pakBarcode = `PAK${Date.now()}`;
  ok(await admin.put(`/api/produk/${sku.produk._id}/sku`, { skus: [{ _id: sku._id, sku: sku.sku, hargaJual: 4000, barcode, isActive: true }] }));
  ok(await admin.put(`/api/produk/${sku.produk._id}/sku/${sku._id}/packages`, { packages: [
    { uom: pak._id, konversi: 6, hargaJual: 22000, barcode: pakBarcode }, { uom: m.box._id, konversi: 24 },
  ] }));
  await postAdjustment(admin, m.gudang._id, [{ sku: sku._id, qtyChange: 60, unitCost: 2500 }], 'OPENING');
  const outlet = ok(await admin.post('/api/outlet', { code: `PO${Date.now() % 100000}`, name: 'Toko', gudang: m.gudang._id }), 201);
  await require('../../controllers/customerController').ensureWalkInCustomer();
  const cashier = await t.loginAs({ pos: ['create'] }, 'Kasir Pak', { outlets: [outlet._id] });
  await t.loginAs({ pos: ['create', 'post'] }, 'Spv Pak', { outlets: [outlet._id] });
  const spv = await t.model('User').findOne({ name: 'Spv Pak' }).sort({ createdDate: -1 }).lean();
  ok(await admin.put(`/api/user/${spv._id}`, { posPin: '4321' }));
  ok(await cashier.post('/api/pos/shift/open', { outlet: outlet._id, openingCash: 200000 }), 201);
  return { m, pak, sku, barcode, pakBarcode, outlet, cashier, spv };
}

test('POS packages: scan package barcode, mixed units in one sale, whole packages, receipt, hold & resume', async () => {
  const admin = await t.loginAs();
  const s = await setup(admin);

  // scan barcode PAK -> SKU persis + matchedUom, pilihan satuan dengan harga
  const found = ok(await s.cashier.get(`/api/pos/skus?search=${s.pakBarcode}`));
  assert.equal(found[0].exact, true);
  assert.equal(String(found[0].matchedUom), String(s.pak._id));
  assert.deepEqual(found[0].units.map((u) => [u.konversi, u.price]), [[1, 4000], [6, 22000], [24, 96000]]);

  const sale = (lines, payments) => s.cashier.post('/api/pos/sales', { lines, payments });
  assert.match((await sale([{ sku: s.sku._id, uom: s.pak._id, qty: 1.5 }], [{ method: 'CASH', amount: 100000 }])).message, /whole number/);
  assert.match((await sale([{ sku: s.sku._id, uom: s.m.box._id, qty: 3 }], [{ method: 'CASH', amount: 300000 }])).message, /stock|Insufficient|not enough/i); // 72 > 60

  // 2 PAK + 3 BTL (SKU sama, satuan beda): 44.000 + 12.000 = 56.000 (harga termasuk PPN outlet)
  const r = ok(await sale([{ sku: s.sku._id, uom: s.pak._id, qty: 2 }, { sku: s.sku._id, qty: 3 }], [{ method: 'CASH', amount: 60000 }]), 201);
  assert.equal(r.total, 56000);
  assert.equal(r.change, 4000);
  const saved = await t.model('SalesInvoice').findById(r._id).lean();
  assert.deepEqual(saved.lines.map((l) => [l.qtyUom, l.konversi, l.qty]), [[2, 6, 12], [3, 1, 3]]);
  assert.equal(await balanceOf(s.sku._id, s.m.gudang._id), 60 - 15);
  const receipt = ok(await s.cashier.get(`/api/pos/sales/${r._id}/receipt`));
  assert.equal(receipt.lines[0].uom.code, s.pak.code);
  assert.equal(receipt.lines[0].produk.uom.code, s.m.pcs.code);

  // hold menyimpan satuan; resume mengembalikan kemasan + harga terbaru
  const h = ok(await s.cashier.post('/api/pos/holds', { lines: [{ sku: s.sku._id, uom: s.pak._id, qty: 1 }, { sku: s.sku._id, qty: 2 }] }), 201);
  const resumed = ok(await s.cashier.post(`/api/pos/holds/${h._id}/resume`));
  assert.deepEqual(resumed.lines.map((l) => [l.konversi, l.qty, l.hargaJual]), [[6, 1, 22000], [1, 2, 4000]]);
  // kemasan dinonaktifkan sebelum dilanjutkan -> baris dilewati
  const h2 = ok(await s.cashier.post('/api/pos/holds', { lines: [{ sku: s.sku._id, uom: s.pak._id, qty: 1 }] }), 201);
  ok(await admin.put(`/api/produk/${s.sku.produk._id}/sku/${s.sku._id}/packages`, { packages: [
    { uom: s.pak._id, konversi: 6, hargaJual: 22000, barcode: s.pakBarcode, isActive: false }, { uom: s.m.box._id, konversi: 24 },
  ] }));
  assert.equal(ok(await s.cashier.post(`/api/pos/holds/${h2._id}/resume`)).skipped, 1);
});

test('POS packages: return part of a package at the register (base units), void restores base stock', async () => {
  const admin = await t.loginAs();
  const s = await setup(admin);
  const r = ok(await s.cashier.post('/api/pos/sales', {
    lines: [{ sku: s.sku._id, uom: s.pak._id, qty: 2 }, { sku: s.sku._id, qty: 1 }], payments: [{ method: 'CASH', amount: 48000 }],
  }), 201);
  const found = ok(await s.cashier.get(`/api/pos/sales/lookup?no=${r.no}`));
  const pakLine = found.lines.find((l) => l.konversi === 6);
  assert.equal(pakLine.returnable, 12);
  assert.equal(pakLine.unitAmount, 3666.67); // 44.000 / 12 (harga termasuk PPN)

  // retur 2 botol dari pak: refund tunai 7.333,33
  const ret = ok(await s.cashier.post('/api/pos/returns', {
    salesInvoice: r._id, lines: [{ invoiceLine: pakLine._id, qty: 2 }], reason: 'Bocor', refundMethod: 'CASH', approver: s.spv._id, pin: '4321',
  }), 201);
  assert.equal(ret.refund.amount, 7333.33);
  assert.equal(await balanceOf(s.sku._id, s.m.gudang._id), 60 - 13 + 2);
  const inv = await t.model('SalesInvoice').findById(r._id).lean();
  assert.deepEqual(inv.lines.map((l) => l.qtyReturned), [2, 0]);
  // SKU sama dalam 2 satuan -> retur per SKU ambigu
  assert.match((await s.cashier.post('/api/pos/returns', {
    salesInvoice: r._id, lines: [{ sku: s.sku._id, qty: 1 }], reason: 'x', refundMethod: 'CASH', approver: s.spv._id, pin: '4321',
  })).message, /several units/);

  // void transaksi lain (tanpa retur): stok kembali dalam satuan dasar
  const r2 = ok(await s.cashier.post('/api/pos/sales', { lines: [{ sku: s.sku._id, uom: s.pak._id, qty: 1 }], payments: [{ method: 'CASH', amount: 22000 }] }), 201);
  const before = await balanceOf(s.sku._id, s.m.gudang._id);
  ok(await s.cashier.post(`/api/pos/sales/${r2._id}/void`, { reason: 'Salah scan', approver: s.spv._id, pin: '4321' }));
  assert.equal(await balanceOf(s.sku._id, s.m.gudang._id), before + 6);
});
