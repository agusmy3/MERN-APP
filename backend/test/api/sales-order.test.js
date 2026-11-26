const { test } = require('node:test');
const assert = require('node:assert/strict');
const { useTestApp } = require('../helpers/setup');
const { ok, createMasters, createProduct, postAdjustment } = require('../helpers/factory');

const t = useTestApp();
const balanceOf = async (sku, gudang) => (await t.model('StockBalance').findOne({ sku, gudang }).lean())?.qty ?? 0;

const ADDRESS = { address: 'Jl. Mawar 1', provinsi: 'DKI Jakarta', kota: 'Jakarta Pusat', kecamatan: 'Menteng', kodePos: '10310' };

/** 2 SKU berstok (A: 10 @ 60.000, B: 5 @ 20.000), harga jual 100.000 / 40.000, customer beralamat */
async function setup(admin) {
  const m = await createMasters(admin);
  const a = await createProduct(admin, m, `SO A ${Date.now()}`);
  const b = await createProduct(admin, m, `SO B ${Date.now()}`);
  await t.model('ProdukSku').updateOne({ _id: a._id }, { hargaJual: 100000 });
  await t.model('ProdukSku').updateOne({ _id: b._id }, { hargaJual: 40000 });
  await postAdjustment(admin, m.gudang._id, [{ sku: a._id, qtyChange: 10, unitCost: 60000 }, { sku: b._id, qtyChange: 5, unitCost: 20000 }], 'OPENING');
  const customer = ok(await admin.post('/api/customer', { name: 'PT Toko Maju', phone: '0812', termDays: 30, ...ADDRESS }), 201);
  return { m, a, b, customer };
}

const soBody = (s, extra = {}) => ({
  customer: s.customer._id,
  gudang: s.m.gudang._id,
  customerPoNo: 'PO-CUST-9',
  lines: [{ sku: s.a._id, qty: 4, hargaJual: 1, diskonPersen: 10 }, { sku: s.b._id, qty: 2 }],
  discountAmount: 10000,
  shippingCharge: 20000,
  ...extra,
});

test('customer & vendor: full location (region, postal code, coordinates)', async () => {
  const admin = await t.loginAs();
  const c = ok(await admin.post('/api/customer', { name: 'Lokasi', ...ADDRESS, latitude: '-6.1954321', longitude: '106.8312345' }), 201);
  assert.equal(c.kota, 'Jakarta Pusat');
  assert.equal(c.kodePos, '10310');
  assert.equal(c.latitude, -6.1954321);
  assert.equal((await admin.post('/api/customer', { name: 'X', kodePos: '123' })).status, 400);
  assert.equal((await admin.post('/api/customer', { name: 'X', latitude: '-6.2' })).status, 400); // longitude kosong
  const upd = ok(await admin.put(`/api/customer/${c._id}`, { latitude: '', longitude: '' }));
  assert.equal(upd.latitude, null);

  const v = ok(await admin.post('/api/vendor', { companyName: 'Vendor Lokasi', picName: 'P', picContact: '1', companyAddress: 'Jl. A', provinsi: 'Jawa Barat', kota: 'Bandung', kecamatan: 'Coblong', kodePos: '40132' }), 201);
  assert.equal(v.kota, 'Bandung');
  assert.equal((await admin.put(`/api/vendor/${v._id}`, { kodePos: 'abcde' })).status, 400);
  const v2 = ok(await admin.put(`/api/vendor/${v._id}`, { latitude: -6.9, longitude: 107.6 }));
  assert.equal(v2.longitude, 107.6);
  assert.equal(v2.kota, 'Bandung'); // field yang tidak dikirim tetap
  const log = await t.model('AuditLog').findOne({ entity: 'vendor', entityId: v._id, action: 'update' }).lean();
  assert.ok(log.changes.some((ch) => ch.field === 'latitude'));
});

test('sales order: frozen prices, ship-to default, shipping & totals, walk-in rejected, no stock change', async () => {
  const admin = await t.loginAs();
  const s = await setup(admin);

  const { ensureWalkInCustomer } = require('../../controllers/customerController');
  const { customer: walkIn } = await ensureWalkInCustomer();
  assert.match((await admin.post('/api/sales-order', soBody(s, { customer: walkIn._id }))).message, /walk-in/);
  const noAddr = ok(await admin.post('/api/customer', { name: 'Tanpa Alamat' }), 201);
  assert.match((await admin.post('/api/sales-order', soBody(s, { customer: noAddr._id }))).message, /Shipping address/);
  ok(await admin.post('/api/sales-order', soBody(s, { customer: noAddr._id, deliveryMethod: 'PICKUP' })), 201); // diambil sendiri: tanpa alamat

  const so = ok(await admin.post('/api/sales-order', soBody(s)), 201);
  assert.match(so.no, /^SO-\d{6}-\d{4}$/);
  assert.equal(so.status, 'DRAFT');
  assert.equal(so.lines[0].hargaJual, 100000); // harga dari harga jual SKU, input klien diabaikan
  assert.equal(so.shipTo.alamat, 'Jl. Mawar 1'); // default alamat customer
  assert.equal(so.shipTo.kodePos, '10310');
  // subtotal 360.000 + 80.000 = 440.000; dpp 430.000; PPN 47.300 + ongkir 20.000 (+2.200)
  assert.equal(so.subtotal, 440000);
  assert.equal(so.dpp, 430000);
  assert.equal(so.shippingTotal, 22200);
  assert.equal(so.taxAmount, 49500);
  assert.equal(so.total, 499500);
  assert.equal(await balanceOf(s.a._id, s.m.gudang._id), 10);

  // alamat kirim lain & validasi wilayah
  assert.equal((await admin.put(`/api/sales-order/${so._id}`, soBody(s, { shipTo: { alamat: 'Gudang Customer', kodePos: '12' } }))).status, 400);
  const edited = ok(await admin.put(`/api/sales-order/${so._id}`, soBody(s, { shipTo: { name: 'Pak Budi', alamat: 'Gudang Customer', kota: 'Bekasi' } })));
  assert.equal(edited.shipTo.kota, 'Bekasi');
  ok(await admin.post(`/api/sales-order/${so._id}/confirm`));
  const conf = ok(await admin.get(`/api/sales-order/${so._id}`));
  assert.equal(conf.status, 'OPEN');
  assert.equal((await admin.put(`/api/sales-order/${so._id}`, soBody(s))).status, 400); // hanya draft
  assert.equal((await admin.del(`/api/sales-order/${so._id}`)).status, 400);

  // stok dipesan (info): tersedia = stok - sisa SO OPEN lain
  const found = ok(await admin.get(`/api/sales-order/skus?gudang=${s.m.gudang._id}&search=${s.a.sku}`));
  const row = found.find((x) => String(x._id) === String(s.a._id));
  assert.equal(row.qty, 10);
  assert.equal(row.committed, 4);
  assert.equal(row.available, 6);
  assert.equal(conf.lines[0].committed, 0); // SO ini sendiri tidak dihitung
  assert.equal(conf.lines[0].available, 10);

  // cancel OPEN
  assert.equal((await admin.post(`/api/sales-order/${so._id}/close`, { reason: 'x' })).status, 400); // belum ada kiriman
  ok(await admin.post(`/api/sales-order/${so._id}/cancel`, { reason: 'Customer batal' }));
  const after = ok(await admin.get(`/api/sales-order/skus?gudang=${s.m.gudang._id}&search=${s.a.sku}`));
  assert.equal(after.find((x) => String(x._id) === String(s.a._id)).committed, 0);
});

test('delivery order: partial deliveries, stock out with COGS, over-delivery rejected, cancel restores', async () => {
  const admin = await t.loginAs();
  const s = await setup(admin);
  const so = ok(await admin.post('/api/sales-order', soBody(s, { confirm: true })), 201);
  assert.equal(so.status, 'OPEN');

  const opts = ok(await admin.get('/api/delivery-order/so-options'));
  assert.ok(opts.some((o) => String(o._id) === String(so._id)));
  const src = ok(await admin.get(`/api/delivery-order/from-so/${so._id}`));
  assert.equal(src.lines[0].outstanding, 4);
  assert.equal(src.lines[0].hargaJual, undefined); // surat jalan tanpa harga

  assert.match((await admin.post('/api/delivery-order', { salesOrder: so._id, lines: [{ sku: s.a._id, qty: 5 }] })).message, /exceeds/);
  const d1 = ok(await admin.post('/api/delivery-order', {
    salesOrder: so._id, vehicleNo: 'B 1234 CD', driverName: 'Joko', lines: [{ sku: s.a._id, qty: 3 }, { sku: s.b._id, qty: 0 }],
  }), 201);
  assert.match(d1.no, /^DO-\d{6}-\d{4}$/);
  assert.equal(d1.lines.length, 1);
  assert.equal(d1.shipTo.alamat, 'Jl. Mawar 1');
  assert.equal(await balanceOf(s.a._id, s.m.gudang._id), 10); // draft tidak mengubah stok
  // SO dengan draft DO tidak bisa dibatalkan
  assert.match((await admin.post(`/api/sales-order/${so._id}/cancel`, { reason: 'x' })).message, /draft delivery/);

  ok(await admin.post(`/api/delivery-order/${d1._id}/post`));
  assert.equal(await balanceOf(s.a._id, s.m.gudang._id), 7);
  const posted = ok(await admin.get(`/api/delivery-order/${d1._id}`));
  assert.equal(posted.lines[0].unitCost, 60000);
  assert.equal(posted.totalValue, 180000);
  let cur = ok(await admin.get(`/api/sales-order/${so._id}`));
  assert.equal(cur.status, 'PARTIAL');
  assert.equal(cur.lines[0].qtyDelivered, 3);
  const mv = await t.model('StockMovement').findOne({ refType: 'DeliveryOrder', refId: d1._id }).lean();
  assert.equal(mv.type, 'SALE');
  assert.equal(mv.qty, -3);

  // DO kedua melengkapi; stok kurang -> ditolak
  await postAdjustment(admin, s.m.gudang._id, [{ sku: s.b._id, qtyChange: -4 }]);
  const d2 = ok(await admin.post('/api/delivery-order', { salesOrder: so._id, lines: [{ sku: s.a._id, qty: 1 }, { sku: s.b._id, qty: 2 }] }), 201);
  assert.equal((await admin.post(`/api/delivery-order/${d2._id}/post`)).status, 400);
  assert.equal(await balanceOf(s.a._id, s.m.gudang._id), 7); // seluruh DO batal
  await postAdjustment(admin, s.m.gudang._id, [{ sku: s.b._id, qtyChange: 4 }]);
  ok(await admin.post(`/api/delivery-order/${d2._id}/post`));
  cur = ok(await admin.get(`/api/sales-order/${so._id}`));
  assert.equal(cur.status, 'DELIVERED');
  assert.equal(cur.deliveries.length, 2);

  // cancel DO -> stok kembali, SO kembali PARTIAL
  assert.equal((await admin.post(`/api/delivery-order/${d2._id}/cancel`, {})).status, 400); // alasan wajib
  ok(await admin.post(`/api/delivery-order/${d2._id}/cancel`, { reason: 'Salah kirim' }));
  assert.equal(await balanceOf(s.a._id, s.m.gudang._id), 7);
  assert.equal(await balanceOf(s.b._id, s.m.gudang._id), 5);
  cur = ok(await admin.get(`/api/sales-order/${so._id}`));
  assert.equal(cur.status, 'PARTIAL');

  // close PARTIAL -> tidak bisa dikirim lagi
  ok(await admin.post(`/api/sales-order/${so._id}/close`, { reason: 'Sisa tidak jadi' }));
  assert.match((await admin.post('/api/delivery-order', { salesOrder: so._id, lines: [{ sku: s.a._id, qty: 1 }] })).message, /closed/);
});

test('invoice from delivery order: proportional discount, shipping on first invoice, no stock change, cancel & returns', async () => {
  const admin = await t.loginAs();
  const s = await setup(admin);
  const so = ok(await admin.post('/api/sales-order', soBody(s, { confirm: true, lines: [{ sku: s.a._id, qty: 4 }], discountAmount: 40000 })), 201);
  // subtotal 400.000, diskon 40.000, ongkir 20.000

  const d1 = ok(await admin.post('/api/delivery-order', { salesOrder: so._id, lines: [{ sku: s.a._id, qty: 1 }] }), 201);
  assert.equal((await admin.post(`/api/delivery-order/${d1._id}/invoice`, {})).status, 400); // belum diposting
  ok(await admin.post(`/api/delivery-order/${d1._id}/post`));

  // izin: tanpa salesInvoice post -> 403
  const staff = await t.loginAs({ deliveryOrder: ['view', 'create', 'update', 'delete', 'post'], salesInvoice: ['view', 'create'] }, 'Gudang');
  assert.equal((await staff.post(`/api/delivery-order/${d1._id}/invoice`, {})).status, 403);
  assert.equal(ok(await staff.get(`/api/delivery-order/${d1._id}`)).lines[0].unitCost, undefined); // tanpa data biaya

  const inv1 = ok(await admin.post(`/api/delivery-order/${d1._id}/invoice`, {}), 201);
  assert.equal(inv1.status, 'POSTED');
  assert.equal(inv1.source, 'SALES_ORDER');
  assert.equal(inv1.subtotal, 100000);
  assert.equal(inv1.discountAmount, 10000);   // 40.000 x 100.000 / 400.000
  assert.equal(inv1.dpp, 90000);
  assert.equal(inv1.shippingCharge, 20000);   // invoice pertama
  assert.equal(inv1.shippingTotal, 22200);
  assert.equal(inv1.total, 90000 + 9900 + 22200);
  assert.equal(inv1.cogs, 60000);
  assert.equal(inv1.paymentStatus, 'UNPAID');
  const due = new Date(inv1.dueDate) - new Date(new Date(inv1.date).setHours(0, 0, 0, 0));
  assert.equal(Math.round(due / 86400000), 30); // termin customer
  assert.equal(await balanceOf(s.a._id, s.m.gudang._id), 9); // invoice tidak mengubah stok lagi
  assert.match((await admin.post(`/api/delivery-order/${d1._id}/invoice`, {})).message, /already invoiced/);
  assert.match((await admin.post(`/api/delivery-order/${d1._id}/cancel`, { reason: 'x' })).message, /invoiced/);

  // invoice kedua melengkapi SO: diskon = sisa, tanpa ongkir
  const d2 = ok(await admin.post('/api/delivery-order', { salesOrder: so._id, lines: [{ sku: s.a._id, qty: 3 }] }), 201);
  ok(await admin.post(`/api/delivery-order/${d2._id}/post`));
  const inv2 = ok(await admin.post(`/api/delivery-order/${d2._id}/invoice`, {}), 201);
  assert.equal(inv2.discountAmount, 30000);
  assert.equal(inv2.shippingCharge, 0);
  assert.equal(inv2.total, 270000 + 29700);

  // retur atas invoice pertama: ongkir tidak ikut diretur
  const ret = ok(await admin.post('/api/sales-return', { salesInvoice: inv1._id, reason: 'Rusak', lines: [{ sku: s.a._id, qty: 1 }] }), 201);
  ok(await admin.post(`/api/sales-return/${ret._id}/post`));
  const invAfter = ok(await admin.get(`/api/sales-invoice/${inv1._id}`));
  assert.equal(invAfter.returnedAmount, 99900);
  assert.equal(invAfter.balance, 22200); // tinggal ongkir
  assert.equal(await balanceOf(s.a._id, s.m.gudang._id), 7);
  ok(await admin.post(`/api/sales-return/${ret._id}/cancel`, { reason: 'Salah input' }));

  // batal invoice: stok tidak berubah, DO bisa ditagih ulang (ongkir pindah ke invoice berikutnya)
  ok(await admin.post(`/api/sales-invoice/${inv1._id}/cancel`, { reason: 'Salah tanggal' }));
  assert.equal(await balanceOf(s.a._id, s.m.gudang._id), 6);
  assert.equal(ok(await admin.get(`/api/delivery-order/${d1._id}`)).invoice, null);
  const inv1b = ok(await admin.post(`/api/delivery-order/${d1._id}/invoice`, {}), 201);
  assert.equal(inv1b.shippingCharge, 20000);
  assert.equal(inv1b.discountAmount, 10000); // melengkapi SO: 40.000 - 30.000

  const soAfter = ok(await admin.get(`/api/sales-order/${so._id}`));
  assert.equal(soAfter.invoices.filter((i) => i.status === 'POSTED').length, 2);
  const list = ok(await admin.get('/api/delivery-order?invoiced=false'));
  assert.ok(!list.dataDeliveryOrder.some((d) => [String(d1._id), String(d2._id)].includes(String(d._id))));
  // histori SO memuat DO-nya
  const hist = ok(await admin.get(`/api/audit-log/history?entity=salesOrder&id=${so._id}`));
  assert.ok(hist.logs.some((l) => l.entity === 'deliveryOrder'));
});

test('sales order permissions & warehouse access', async () => {
  const admin = await t.loginAs();
  const s = await setup(admin);
  const other = ok(await admin.post('/api/gudang', { code: `OTH${Date.now() % 10000}`, name: 'Other' }), 201);
  const viewer = await t.loginAs({ salesOrder: ['view'] }, 'Viewer');
  assert.equal((await viewer.post('/api/sales-order', soBody(s))).status, 403);
  assert.equal((await viewer.get('/api/delivery-order')).status, 403);
  const scoped = await t.loginAs({ salesOrder: ['view', 'create'] }, 'Scoped', { gudangs: [other._id] });
  assert.equal((await scoped.post('/api/sales-order', soBody(s))).status, 403);
  const so = ok(await admin.post('/api/sales-order', soBody(s)), 201);
  assert.equal((await scoped.get(`/api/sales-order/${so._id}`)).status, 403);
  assert.ok(!ok(await scoped.get('/api/sales-order')).dataSalesOrder.length);

  // master yang dipakai SO tidak bisa dihapus
  const delCust = await admin.del(`/api/customer/${s.customer._id}`);
  assert.equal(delCust.status, 400);
  assert.equal((await admin.del(`/api/gudang/${s.m.gudang._id}`)).status, 400);
});
