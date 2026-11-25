const { test } = require('node:test');
const assert = require('node:assert/strict');
const { useTestApp } = require('../helpers/setup');
const { ok, createMasters, createProduct, postAdjustment } = require('../helpers/factory');

const t = useTestApp();
const balanceOf = async (sku, gudang) => (await t.model('StockBalance').findOne({ sku, gudang }).lean())?.qty ?? 0;

const CASHIER = { pos: ['create'] };

/** master + SKU (harga 11.100, HPP 6.000, stok 20, barcode) + outlet + customer walk-in */
async function setup(admin) {
  const m = await createMasters(admin);
  const sku = await createProduct(admin, m, `Kasir ${Date.now()}`);
  const barcode = `899${Date.now()}`;
  ok(await admin.put(`/api/produk/${sku.produk._id}/sku`, { skus: [{ _id: sku._id, sku: sku.sku, hargaJual: 11100, barcode, isActive: true }] }));
  await postAdjustment(admin, m.gudang._id, [{ sku: sku._id, qtyChange: 20, unitCost: 6000 }], 'OPENING');
  const outlet = ok(await admin.post('/api/outlet', {
    code: `OUT${Date.now() % 100000}`, name: 'Toko Depan', gudang: m.gudang._id,
    provinsi: 'Jawa Barat', kota: 'Kota Bandung', kecamatan: 'Coblong', kodePos: '40132', latitude: -6.8915, longitude: 107.6107,
    receiptFooter: 'Terima kasih',
  }), 201);
  const { ensureWalkInCustomer } = require('../../controllers/customerController');
  await ensureWalkInCustomer();
  return { m, sku, barcode, outlet };
}

test('outlet: location validation, warehouse required, delete rules', async () => {
  const admin = await t.loginAs();
  const s = await setup(admin);
  assert.equal(s.outlet.priceIncludesTax, true);
  assert.equal(s.outlet.kodePos, '40132');
  assert.equal(s.outlet.latitude, -6.8915);
  const bad = (body) => admin.post('/api/outlet', { code: `X${Date.now()}`, name: 'X', gudang: s.m.gudang._id, ...body });
  assert.equal((await bad({ kodePos: '123' })).status, 400);
  assert.equal((await bad({ latitude: 1 })).status, 400);               // longitude kosong
  assert.equal((await bad({ gudang: null })).status, 400);
  assert.equal((await bad({ receiptWidth: 70 })).status, 400);
  // gudang yang memasok outlet tidak bisa dihapus
  const del = await admin.del(`/api/gudang/${s.m.gudang._id}`);
  assert.equal(del.status, 400);
  // outlet tanpa shift bisa dihapus & dilepas dari kasir
  const tmp = ok(await bad({}), 201);
  const cashier = await t.loginAs(CASHIER, 'Kasir Hapus', { outlets: [tmp._id] });
  ok(await admin.del(`/api/outlet/${tmp._id}`));
  const ctx = ok(await cashier.get('/api/pos/context'));
  assert.equal(ctx.outlets.length, 0);
});

test('POS: shift required, assignment, sale with split payment & change, stock, shift close', async () => {
  const admin = await t.loginAs();
  const s = await setup(admin);
  const cashier = await t.loginAs(CASHIER, 'Kasir A', { outlets: [s.outlet._id] });
  const stranger = await t.loginAs(CASHIER, 'Kasir B');

  // belum ada shift -> tidak bisa jualan / cari SKU
  const sale = (user, body) => user.post('/api/pos/sales', body);
  assert.equal((await sale(cashier, { lines: [{ sku: s.sku._id, qty: 1 }], payments: [{ method: 'CASH', amount: 20000 }] })).status, 400);
  assert.equal((await cashier.get(`/api/pos/skus?search=${s.barcode}`)).status, 400);
  // outlet tidak ditugaskan -> 403
  assert.equal((await stranger.post('/api/pos/shift/open', { outlet: s.outlet._id, openingCash: 0 })).status, 403);

  const shift = ok(await cashier.post('/api/pos/shift/open', { outlet: s.outlet._id, openingCash: 100000 }), 201);
  assert.match(shift.no, /^SHF-/);
  assert.equal((await cashier.post('/api/pos/shift/open', { outlet: s.outlet._id, openingCash: 0 })).status, 400); // 1 shift OPEN

  // scan barcode -> exact
  const found = ok(await cashier.get(`/api/pos/skus?search=${s.barcode}`));
  assert.equal(found[0]._id, s.sku._id);
  assert.equal(found[0].exact, true);
  assert.equal(found[0].price, 11100);
  assert.equal(found[0].qty, 20);

  // pembayaran kurang / non-tunai berlebih ditolak
  const lines = [{ sku: s.sku._id, qty: 2, hargaJual: 1 }]; // harga klien diabaikan
  assert.equal((await sale(cashier, { lines, payments: [{ method: 'CASH', amount: 10000 }] })).status, 400);
  assert.equal((await sale(cashier, { lines, payments: [{ method: 'QRIS', amount: 30000 }] })).status, 400);
  assert.equal((await sale(cashier, { lines, payments: [{ method: 'GOPAY', amount: 30000 }] })).status, 400);

  // 2 x 11.100 = 22.200 (termasuk PPN 11% -> dpp 20.000); bayar QRIS 10.000 + tunai 20.000 -> kembali 7.800
  const res = ok(await sale(cashier, { lines, payments: [{ method: 'QRIS', amount: 10000, reference: 'QR-1' }, { method: 'CASH', amount: 20000 }] }), 201);
  assert.match(res.no, /^POS-/);
  assert.equal(res.total, 22200);
  assert.equal(res.change, 7800);
  const inv = ok(await admin.get(`/api/sales-invoice/${res._id}`));
  assert.equal(inv.status, 'POSTED');
  assert.equal(inv.paymentStatus, 'PAID');
  assert.equal(inv.dpp, 20000);
  assert.equal(inv.taxAmount, 2200);
  assert.equal(inv.cogs, 12000);
  assert.equal(inv.payments.length, 2);
  assert.equal(inv.payments.find((p) => p.method === 'CASH').amount, 12200); // tunai bersih
  assert.equal(await balanceOf(s.sku._id, s.m.gudang._id), 18);

  // struk
  const receipt = ok(await cashier.get(`/api/pos/sales/${res._id}/receipt`));
  assert.equal(receipt.outlet.receiptFooter, 'Terima kasih');
  assert.equal(receipt.cashTendered, 20000);
  assert.equal(receipt.lines[0].unitCost, undefined);
  assert.equal((await stranger.get(`/api/pos/sales/${res._id}/receipt`)).status, 403);

  // stok kurang -> seluruh transaksi batal
  assert.equal((await sale(cashier, { lines: [{ sku: s.sku._id, qty: 50 }], payments: [{ method: 'CASH', amount: 1000000 }] })).status, 400);
  assert.equal(await balanceOf(s.sku._id, s.m.gudang._id), 18);

  // kas masuk / keluar
  ok(await cashier.post('/api/pos/shift/cash', { type: 'OUT', amount: 5000, reason: 'Beli galon' }));
  ok(await cashier.post('/api/pos/shift/cash', { type: 'IN', amount: 2000, reason: 'Tambah receh' }));
  assert.equal((await cashier.post('/api/pos/shift/cash', { type: 'OUT', amount: 1, reason: '' })).status, 400);
  assert.equal((await cashier.post('/api/pos/shift/cash', { type: 'OUT', amount: 999999, reason: 'x' })).status, 400); // > laci
  const ctx = ok(await cashier.get('/api/pos/context'));
  // 100.000 + 12.200 - 5.000 + 2.000
  assert.equal(ctx.shift.summary.expectedCash, 109200);
  assert.equal(ctx.shift.summary.byMethod.QRIS, 10000);
  assert.equal(ctx.shift.summary.salesCount, 1);
  assert.equal(ctx.shift.recent.length, 1);

  // tutup: selisih wajib catatan
  assert.equal((await cashier.post('/api/pos/shift/close', { closingCash: 109000 })).status, 400);
  const closed = ok(await cashier.post('/api/pos/shift/close', { closingCash: 109000, note: 'Kurang 200, salah kembalian' }));
  assert.equal(closed.status, 'CLOSED');
  assert.equal(closed.expectedCash, 109200);
  assert.equal(closed.difference, -200);
  assert.equal(closed.salesTotal, 22200);
  assert.equal((await sale(cashier, { lines, payments: [{ method: 'CASH', amount: 30000 }] })).status, 400); // shift tutup

  // pembayaran di shift yang sudah tutup tidak bisa dibatalkan
  const cashPay = inv.payments.find((p) => p.method === 'CASH');
  assert.equal((await admin.post(`/api/sales-payment/${cashPay._id}/cancel`, { reason: 'x' })).status, 400);

  // supervisor: daftar & detail shift; kasir tanpa izin posShift -> 403
  const list = ok(await admin.get('/api/pos-shift?status=CLOSED'));
  assert.ok(list.dataPosShift.some((x) => x._id === shift._id));
  const detail = ok(await admin.get(`/api/pos-shift/${shift._id}`));
  assert.equal(detail.sales.length, 1);
  assert.equal(detail.cashMoves.length, 2);
  assert.equal((await cashier.get('/api/pos-shift')).status, 403);
});

test('POS: supervisor force-closes a cashier shift; customer price list applies; barcode unique', async () => {
  const admin = await t.loginAs();
  const s = await setup(admin);
  const cashier = await t.loginAs(CASHIER, 'Kasir C', { outlets: [s.outlet._id] });
  const shift = ok(await cashier.post('/api/pos/shift/open', { outlet: s.outlet._id, openingCash: 50000 }), 201);

  // price list customer berlaku di POS
  const pl = ok(await admin.post('/api/price-list', { code: `POS${Date.now()}`, name: 'Member', items: [{ sku: s.sku._id, price: 9990 }] }), 201);
  const member = ok(await admin.post('/api/customer', { name: 'Member', priceList: pl._id }), 201);
  const r = ok(await cashier.post('/api/pos/sales', { customer: member._id, lines: [{ sku: s.sku._id, qty: 1 }], payments: [{ method: 'CARD', amount: 9990 }] }), 201);
  assert.equal(r.total, 9990);
  assert.equal(r.change, null);

  const supervisor = await t.loginAs({ posShift: ['update'] }, 'Supervisor');
  assert.equal((await supervisor.post(`/api/pos-shift/${shift._id}/close`, { closingCash: 50000 })).status, 200);
  assert.equal((await supervisor.post(`/api/pos-shift/${shift._id}/close`, { closingCash: 50000 })).status, 400);

  // barcode harus unik antar SKU
  const other = await createProduct(admin, s.m, 'Barcode Lain');
  const dup = await admin.put(`/api/produk/${other.produk._id}/sku`, { skus: [{ _id: other._id, sku: other.sku, hargaJual: 1, barcode: s.barcode, isActive: true }] });
  assert.equal(dup.status, 400);
  assert.match(dup.message, /already used/);
  // barcode dikosongkan = dihapus
  ok(await admin.put(`/api/produk/${s.sku.produk._id}/sku`, { skus: [{ _id: s.sku._id, sku: s.sku.sku, hargaJual: 11100, barcode: '', isActive: true }] }));
  assert.equal((await t.model('ProdukSku').findById(s.sku._id).lean()).barcode, undefined);
});
