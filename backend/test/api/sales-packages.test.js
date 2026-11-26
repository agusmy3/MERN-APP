const { test } = require('node:test');
const assert = require('node:assert/strict');
const { useTestApp } = require('../helpers/setup');
const { ok, createMasters, createProduct, postAdjustment } = require('../helpers/factory');

const t = useTestApp();
const balanceOf = async (sku, gudang) => (await t.model('StockBalance').findOne({ sku, gudang }).lean())?.qty ?? 0;
const ADDRESS = { address: 'Jl. Grosir 1', provinsi: 'Jawa Barat', kota: 'Bekasi', kecamatan: 'Bekasi Timur', kodePos: '17111' };

/** Air mineral: PCS @3.500, DUS isi 24 @78.000, PAK isi 6 (harga kosong = 6 x 3.500); stok 240 PCS @2.000 */
async function setup(admin) {
  const m = await createMasters(admin);
  const pak = ok(await admin.post('/api/uom', { code: `PAK${Date.now() % 100000}`, name: 'Pak', type: 'PACK' }), 201);
  const sku = await createProduct(admin, m, `Air ${Date.now()}`);
  await t.model('ProdukSku').updateOne({ _id: sku._id }, { hargaJual: 3500, barcode: `B${Date.now()}` });
  await postAdjustment(admin, m.gudang._id, [{ sku: sku._id, qtyChange: 240, unitCost: 2000 }], 'OPENING');
  const url = `/api/produk/${sku.produk._id}/sku/${sku._id}/packages`;
  const customer = ok(await admin.post('/api/customer', { name: 'Toko Grosir', ...ADDRESS }), 201);
  return { m, pak, sku, url, customer };
}

test('selling packages: validation, prices (package, default, price list), whole quantities, audit', async () => {
  const admin = await t.loginAs();
  const s = await setup(admin);
  const fresh = await t.model('ProdukSku').findById(s.sku._id).lean();

  assert.match((await admin.put(s.url, { packages: [{ uom: s.m.pcs._id, konversi: 2 }] })).message, /base unit/);
  assert.match((await admin.put(s.url, { packages: [{ uom: s.m.box._id, konversi: 1 }] })).message, /more than 1/);
  assert.match((await admin.put(s.url, { packages: [{ uom: s.m.box._id, konversi: 24, barcode: fresh.barcode }] })).message, /already used/);
  const kg = ok(await admin.post('/api/uom', { code: `KG${Date.now() % 100000}`, name: 'Kilo', type: 'WEIGHT' }), 201);
  assert.match((await admin.put(s.url, { packages: [{ uom: kg._id, konversi: 5 }] })).message, /cannot be converted/);
  const saved = ok(await admin.put(s.url, { packages: [
    { uom: s.m.box._id, konversi: 24, hargaJual: 78000, barcode: `DUS-${Date.now()}` },
    { uom: s.pak._id, konversi: 6 },
  ] }));
  assert.equal(saved.packages.length, 2);
  const log = await t.model('AuditLog').findOne({ entity: 'produkSku', entityId: s.sku._id, action: 'update' }).sort({ _id: -1 }).lean();
  assert.ok(log.changes.some((c) => c.field === 'packages'));

  // pencarian SKU: pilihan satuan + harga; scan barcode kemasan
  const found = ok(await admin.get(`/api/sales-order/skus?gudang=${s.m.gudang._id}&search=${encodeURIComponent(fresh.sku)}`));
  assert.deepEqual(found[0].units.map((u) => [u.konversi, u.price]), [[1, 3500], [6, 21000], [24, 78000]]);
  const scanned = ok(await admin.get(`/api/sales-invoice/skus?gudang=${s.m.gudang._id}&search=${encodeURIComponent(saved.packages[0].barcode)}`));
  assert.equal(String(scanned[0].matchedUom), String(s.m.box._id));

  // invoice: 2 DUS + 3 PAK + 5 PCS (SKU sama, satuan beda) -> stok keluar 48 + 18 + 5
  const body = (lines, extra = {}) => ({ customer: s.customer._id, gudang: s.m.gudang._id, taxRate: 0, lines, ...extra });
  assert.match((await admin.post('/api/sales-invoice', body([{ sku: s.sku._id, uom: s.m.box._id, qty: 1.5 }]))).message, /whole number/);
  assert.match((await admin.post('/api/sales-invoice', body([{ sku: s.sku._id, uom: s.m.box._id, qty: 1 }, { sku: s.sku._id, uom: s.m.box._id, qty: 2 }]))).message, /more than once/);
  const draft = ok(await admin.post('/api/sales-invoice', body([
    { sku: s.sku._id, uom: s.m.box._id, qty: 2 },
    { sku: s.sku._id, uom: s.pak._id, qty: 3 },
    { sku: s.sku._id, qty: 5 },
  ])), 201);
  assert.deepEqual(draft.lines.map((l) => [l.qtyUom, l.konversi, l.qty, l.hargaJual, l.subtotal]),
    [[2, 24, 48, 78000, 156000], [3, 6, 18, 21000, 63000], [5, 1, 5, 3500, 17500]]);
  assert.equal(draft.subtotal, 236500);
  const posted = ok(await admin.post(`/api/sales-invoice/${draft._id}/post`));
  assert.equal(posted.cogs, 71 * 2000);
  assert.equal(await balanceOf(s.sku._id, s.m.gudang._id), 240 - 71);

  // retur dalam satuan dasar dari baris DUS: 3 botol = 3/48 nilai baris
  const dusLine = posted.lines[0];
  assert.match((await admin.post('/api/sales-return', { salesInvoice: posted._id, reason: 'Rusak', lines: [{ sku: s.sku._id, qty: 1 }] })).message, /several units/);
  const ret = ok(await admin.post('/api/sales-return', { salesInvoice: posted._id, reason: 'Pecah', lines: [{ invoiceLine: dusLine._id, qty: 3 }] }), 201);
  assert.equal(ret.lines[0].subtotal, 9750); // 156.000 / 48 x 3
  ok(await admin.post(`/api/sales-return/${ret._id}/post`));
  const after = ok(await admin.get(`/api/sales-invoice/${posted._id}`));
  assert.equal(after.lines[0].qtyReturned, 3);
  assert.equal(after.lines[1].qtyReturned, 0);
  assert.equal(await balanceOf(s.sku._id, s.m.gudang._id), 240 - 71 + 3);

  // price list per kemasan
  const pl = ok(await admin.post('/api/price-list', { code: `GRS${Date.now() % 100000}`, name: 'Grosir', items: [
    { sku: s.sku._id, price: 3300 }, { sku: s.sku._id, uom: s.m.box._id, price: 75000 },
  ] }), 201);
  ok(await admin.put(`/api/customer/${s.customer._id}`, { priceList: pl._id }));
  const prices = ok(await admin.post('/api/sales-invoice/skus/prices', { customer: s.customer._id, items: [
    { sku: s.sku._id }, { sku: s.sku._id, uom: s.m.box._id }, { sku: s.sku._id, uom: s.pak._id },
  ] }));
  assert.equal(prices[`${s.sku._id}:`].price, 3300);
  assert.equal(prices[`${s.sku._id}:${s.m.box._id}`].price, 75000);
  assert.equal(prices[`${s.sku._id}:${s.pak._id}`].price, 19800); // 6 x harga price list satuan
  assert.equal(prices[`${s.sku._id}:${s.pak._id}`].source, 'list');

  // kemasan terpakai tidak bisa dihapus, hanya dinonaktifkan
  assert.match((await admin.put(s.url, { packages: [{ uom: s.pak._id, konversi: 6 }] })).message, /Deactivate/);
  ok(await admin.put(s.url, { packages: [{ uom: s.m.box._id, konversi: 24, hargaJual: 78000, isActive: false }, { uom: s.pak._id, konversi: 6 }] }));
  assert.match((await admin.post('/api/sales-invoice', body([{ sku: s.sku._id, uom: s.m.box._id, qty: 1 }]))).message, /inactive/);
  assert.match((await admin.put(`/api/produk/${s.sku.produk._id}`, { name: 'X', kategori: s.m.kategori._id, uom: s.pak._id, variants: [] })).message, /selling packages/);
});

test('sales order in packages -> delivery in the same package (whole numbers) -> invoice -> credit & backorder in base units; quotation keeps package price', async () => {
  const admin = await t.loginAs();
  const s = await setup(admin);
  ok(await admin.put(s.url, { packages: [{ uom: s.m.box._id, konversi: 24, hargaJual: 78000 }] }));

  // quotation dalam DUS -> SO memakai harga & kemasan penawaran
  const q = ok(await admin.post('/api/quotation', { customer: s.customer._id, gudang: s.m.gudang._id, taxRate: 0, send: true, lines: [{ sku: s.sku._id, uom: s.m.box._id, qty: 5 }] }), 201);
  ok(await admin.put(s.url, { packages: [{ uom: s.m.box._id, konversi: 24, hargaJual: 80000 }] }));
  const conv = ok(await admin.post(`/api/quotation/${q._id}/convert`, {}), 201);
  assert.equal(conv.salesOrder.lines[0].hargaJual, 78000);
  assert.equal(conv.salesOrder.lines[0].qty, 120);
  ok(await admin.del(`/api/sales-order/${conv.salesOrder._id}`));

  const so = ok(await admin.post('/api/sales-order', {
    customer: s.customer._id, gudang: s.m.gudang._id, taxRate: 0, deliveryMethod: 'PICKUP', confirm: true,
    lines: [{ sku: s.sku._id, uom: s.m.box._id, qty: 5 }, { sku: s.sku._id, qty: 10 }],
  }), 201);
  const [dusLine, pcsLine] = so.lines;
  assert.equal(dusLine.qty, 120);
  assert.equal(so.total, 5 * 80000 + 10 * 3500);
  const credit = ok(await admin.get(`/api/customer/${s.customer._id}`)).credit;
  assert.equal(credit.uninvoiced, 435000);
  const reorderish = ok(await admin.get(`/api/sales-order/${so._id}`));
  assert.equal(reorderish.lines[0].committed, 0); // dipesan SO lain
  assert.equal((await t.model('SalesOrder').findById(so._id).lean()).lines[0].qtyUom, 5);

  // surat jalan: kemasan sama dengan SO, bulat, sisa dalam DUS
  const fromSo = ok(await admin.get(`/api/delivery-order/from-so/${so._id}`));
  assert.equal(fromSo.lines[0].outstanding, 5);
  assert.equal(fromSo.lines[0].outstandingBase, 120);
  assert.match((await admin.post('/api/delivery-order', { salesOrder: so._id, lines: [{ soLine: dusLine._id, qty: 1.5 }] })).message, /whole number/);
  assert.match((await admin.post('/api/delivery-order', { salesOrder: so._id, lines: [{ soLine: dusLine._id, qty: 6 }] })).message, /exceeds the outstanding quantity 5/);
  assert.match((await admin.post('/api/delivery-order', { salesOrder: so._id, lines: [{ sku: s.sku._id, qty: 1 }] })).message, /several units/);
  const d = ok(await admin.post('/api/delivery-order', { salesOrder: so._id, lines: [{ soLine: dusLine._id, qty: 2 }, { soLine: pcsLine._id, qty: 4 }] }), 201);
  assert.deepEqual(d.lines.map((l) => [l.qtyUom, l.qty]), [[2, 48], [4, 4]]);
  ok(await admin.post(`/api/delivery-order/${d._id}/post`));
  assert.equal(await balanceOf(s.sku._id, s.m.gudang._id), 240 - 52);
  const dd = ok(await admin.get(`/api/delivery-order/${d._id}`));
  assert.deepEqual(dd.lines.map((l) => [l.ordered, l.delivered, l.outstanding]), [[5, 2, 3], [10, 4, 6]]);
  const bo = ok(await admin.get(`/api/sales-report/backorder?search=${so.no}`));
  assert.deepEqual(bo.rows.map((r) => r.outstanding).sort((a, b) => a - b), [6, 72]);

  const inv = ok(await admin.post(`/api/delivery-order/${d._id}/invoice`, {}), 201);
  assert.deepEqual(inv.lines.map((l) => [l.qtyUom, l.qty, l.hargaJual, l.subtotal]), [[2, 48, 80000, 160000], [4, 4, 3500, 14000]]);
  assert.equal(inv.cogs, 52 * 2000);
  assert.equal(ok(await admin.get(`/api/customer/${s.customer._id}`)).credit.exposure, 435000);
  assert.equal(ok(await admin.get(`/api/sales-order/${so._id}`)).status, 'PARTIAL');
});

test('migration of old sales lines: line ids, delivery & return links', async () => {
  const admin = await t.loginAs();
  const s = await setup(admin);
  const so = ok(await admin.post('/api/sales-order', { customer: s.customer._id, gudang: s.m.gudang._id, deliveryMethod: 'PICKUP', confirm: true, lines: [{ sku: s.sku._id, qty: 3 }] }), 201);
  const d = ok(await admin.post('/api/delivery-order', { salesOrder: so._id, lines: [{ sku: s.sku._id, qty: 2 }] }), 201);
  const db = t.model('SalesOrder').db.db;
  // simulasi data lama: hapus _id baris SO & soLine DO
  await db.collection('salesorders').updateOne({ _id: so._id ? new (require('mongoose').Types.ObjectId)(String(so._id)) : null }, { $unset: { 'lines.$[]._id': '' } });
  await db.collection('deliveryorders').updateOne({ _id: new (require('mongoose').Types.ObjectId)(String(d._id)) }, { $set: { 'lines.$[].soLine': null } });
  const { migrateSalesLines } = require('../../scripts/migrate-sales-lines');
  const r = await migrateSalesLines(db);
  assert.equal(r.lineIds, 1);
  assert.equal(r.deliveryLinks, 1);
  const soNow = await t.model('SalesOrder').findById(so._id).lean();
  const dNow = await t.model('DeliveryOrder').findById(d._id).lean();
  assert.equal(String(dNow.lines[0].soLine), String(soNow.lines[0]._id));
  ok(await admin.post(`/api/delivery-order/${d._id}/post`));
  assert.equal((await t.model('SalesOrder').findById(so._id).lean()).lines[0].qtyDelivered, 2);
  assert.deepEqual(await migrateSalesLines(db), { lineIds: 0, deliveryLinks: 0, returnLinks: 0 }); // idempotent
});
