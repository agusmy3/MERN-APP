const { test } = require('node:test');
const assert = require('node:assert/strict');
const { useTestApp } = require('../helpers/setup');
const { ok, createMasters, createProduct, postAdjustment } = require('../helpers/factory');
const { salesTotals, salesLineSubtotal } = require('../../helpers/salesHelper');

const t = useTestApp();
const skuDoc = (id) => t.model('ProdukSku').findById(id).lean();
const balanceOf = async (sku, gudang) => (await t.model('StockBalance').findOne({ sku, gudang }).lean())?.qty ?? 0;

/** master + 1 SKU berstok 10 @ HPP 60.000 + 1 customer */
async function setup(admin) {
  const m = await createMasters(admin);
  const sku = await createProduct(admin, m, `Jual ${Date.now()}`);
  await postAdjustment(admin, m.gudang._id, [{ sku: sku._id, qtyChange: 10, unitCost: 60000 }], 'OPENING');
  const customer = ok(await admin.post('/api/customer', { name: 'PT Pelanggan', phone: '0811' }), 201);
  return { m, sku, customer };
}

const draftBody = (s, extra = {}) => ({
  customer: s.customer._id,
  gudang: s.m.gudang._id,
  lines: [{ sku: s.sku._id, qty: 2, hargaJual: 100000, diskonPersen: 10 }],
  ...extra,
});

test('sales totals: line & document discount, PPN exclusive / inclusive', () => {
  const lines = [{ qty: 2, hargaJual: 100000, diskonPersen: 10 }, { qty: 1, hargaJual: 50000 }]
    .map((l) => ({ ...l, subtotal: salesLineSubtotal(l) }));
  assert.deepEqual(salesTotals(lines, { discountAmount: 30000, taxRate: 11 }),
    { subtotal: 230000, discountAmount: 30000, dpp: 200000, taxAmount: 22000, total: 222000 });
  assert.deepEqual(salesTotals(lines, { discountAmount: 30000, taxRate: 11, priceIncludesTax: true }),
    { subtotal: 230000, discountAmount: 30000, dpp: 180180.18, taxAmount: 19819.82, total: 200000 });
});

test('customer: auto code, walk-in protected, inactive / used customer rules', async () => {
  const admin = await t.loginAs();
  const c = ok(await admin.post('/api/customer', { name: 'Budi' }), 201);
  assert.match(c.code, /^CUST\d{5}$/);
  assert.equal((await admin.post('/api/customer', { name: '' })).status, 400);
  assert.equal((await admin.post('/api/customer', { name: 'X', email: 'bukan-email' })).status, 400);

  const { ensureWalkInCustomer } = require('../../controllers/customerController');
  const { customer: walkIn } = await ensureWalkInCustomer();
  assert.equal((await ensureWalkInCustomer()).created, false);
  assert.equal((await admin.del(`/api/customer/${walkIn._id}`)).status, 400);
  assert.equal((await admin.put(`/api/customer/${walkIn._id}`, { isActive: false })).status, 400);
  const dd = ok(await admin.get('/api/customer/dropdown'));
  assert.equal(String(dd[0]._id), String(walkIn._id)); // walk-in di urutan pertama

  // customer nonaktif tidak bisa dipakai; customer yang dipakai invoice tidak bisa dihapus
  const s = await setup(admin);
  ok(await admin.put(`/api/customer/${s.customer._id}`, { isActive: false }));
  assert.equal((await admin.post('/api/sales-invoice', draftBody(s))).status, 400);
  ok(await admin.put(`/api/customer/${s.customer._id}`, { isActive: true }));
  ok(await admin.post('/api/sales-invoice', draftBody(s)), 201);
  const del = await admin.del(`/api/customer/${s.customer._id}`);
  assert.equal(del.status, 400);
  assert.match(del.message, /Deactivate/);
  ok(await admin.del(`/api/customer/${c._id}`));
});

test('invoice: draft totals from settings, post reduces stock with COGS, cancel restores', async () => {
  const admin = await t.loginAs();
  const s = await setup(admin);

  const draft = ok(await admin.post('/api/sales-invoice', draftBody(s, { discountAmount: 10000 })), 201);
  assert.match(draft.no, /^INV-\d{6}-\d{4}$/);
  assert.equal(draft.status, 'DRAFT');
  assert.equal(draft.taxRate, 11);              // PKP default -> tarif PPN
  assert.equal(draft.priceIncludesTax, false);
  assert.equal(draft.subtotal, 180000);
  assert.equal(draft.dpp, 170000);
  assert.equal(draft.taxAmount, 18700);
  assert.equal(draft.total, 188700);
  assert.equal(await balanceOf(s.sku._id, s.m.gudang._id), 10); // draft tidak mengubah stok

  // diskon dokumen > subtotal ditolak
  assert.equal((await admin.put(`/api/sales-invoice/${draft._id}`, draftBody(s, { discountAmount: 999999 }))).status, 400);

  const detail = ok(await admin.get(`/api/sales-invoice/${draft._id}`));
  assert.equal(detail.lines[0].currentQty, 10);
  assert.equal(detail.lines[0].unitCost, 60000);   // perkiraan HPP
  assert.equal(detail.grossProfit, 170000 - 120000);

  const posted = ok(await admin.post(`/api/sales-invoice/${draft._id}/post`));
  assert.equal(posted.status, 'POSTED');
  assert.equal(posted.cogs, 120000);
  assert.equal(await balanceOf(s.sku._id, s.m.gudang._id), 8);
  const mv = await t.model('StockMovement').findOne({ refId: draft._id, type: 'SALE' }).lean();
  assert.equal(mv.qty, -2);
  assert.equal(mv.unitCost, 60000);
  assert.equal((await admin.put(`/api/sales-invoice/${draft._id}`, draftBody(s))).status, 400); // posted tidak bisa diedit
  assert.equal((await admin.del(`/api/sales-invoice/${draft._id}`)).status, 400);

  assert.equal((await admin.post(`/api/sales-invoice/${draft._id}/cancel`, {})).status, 400); // alasan wajib
  const cancelled = ok(await admin.post(`/api/sales-invoice/${draft._id}/cancel`, { reason: 'Salah input' }));
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(await balanceOf(s.sku._id, s.m.gudang._id), 10);
  assert.equal((await skuDoc(s.sku._id)).avgCost, 60000); // HPP tidak berubah
  assert.equal((await admin.post(`/api/sales-invoice/${draft._id}/cancel`, { reason: 'lagi' })).status, 400);

  // histori invoice tercatat di audit
  const logs = await t.model('AuditLog').find({ entity: 'salesInvoice', entityId: draft._id }).lean();
  assert.ok(logs.length >= 3);
});

test('invoice: oversell rejected atomically; inactive SKU cannot be sold; price incl. PPN', async () => {
  const admin = await t.loginAs();
  const s = await setup(admin);
  const other = await createProduct(admin, s.m, 'Jual Lain');
  await postAdjustment(admin, s.m.gudang._id, [{ sku: other._id, qtyChange: 5, unitCost: 1000 }], 'OPENING');

  const draft = ok(await admin.post('/api/sales-invoice', draftBody(s, {
    lines: [{ sku: other._id, qty: 1, hargaJual: 2000 }, { sku: s.sku._id, qty: 11, hargaJual: 100000 }],
  })), 201);
  const res = await admin.post(`/api/sales-invoice/${draft._id}/post`);
  assert.equal(res.status, 400);
  assert.match(res.message, /stock is 10/);
  assert.equal(await balanceOf(other._id, s.m.gudang._id), 5); // baris lain ikut batal
  assert.equal((await t.model('SalesInvoice').findById(draft._id).lean()).status, 'DRAFT');

  // harga termasuk PPN
  const incl = ok(await admin.post('/api/sales-invoice', draftBody(s, {
    priceIncludesTax: true, lines: [{ sku: s.sku._id, qty: 1, hargaJual: 111000 }],
  })), 201);
  assert.equal(incl.total, 111000);
  assert.equal(incl.taxAmount, 11000);
  assert.equal(incl.dpp, 100000);

  await t.model('ProdukSku').updateOne({ _id: other._id }, { isActive: false });
  const inactive = await admin.post('/api/sales-invoice', draftBody(s, { lines: [{ sku: other._id, qty: 1, hargaJual: 1 }] }));
  assert.equal(inactive.status, 400);
  assert.match(inactive.message, /inactive/);

  // SKU, gudang & customer yang dipakai invoice tidak bisa dihapus
  assert.equal((await admin.del(`/api/produk/${s.sku.produk._id}/sku/${s.sku._id}`)).status, 400);
  assert.equal((await admin.del(`/api/gudang/${s.m.gudang._id}`)).status, 400);
});

test('permissions: cost hidden without vendorPrice:view, post needs post, warehouse access', async () => {
  const admin = await t.loginAs();
  const s = await setup(admin);
  const B = ok(await admin.post('/api/gudang', { code: `${s.m.gudang.code}B`, name: 'Gudang B' }), 201);

  const clerk = await t.loginAs({ salesInvoice: ['create', 'update', 'delete'] }, 'Clerk', { gudangs: [s.m.gudang._id] });
  const draft = ok(await clerk.post('/api/sales-invoice', draftBody(s)), 201);
  const detail = ok(await clerk.get(`/api/sales-invoice/${draft._id}`));
  assert.equal(detail.canSeeCost, false);
  assert.equal(detail.lines[0].unitCost, undefined);
  assert.equal(detail.cogs, undefined);
  const found = ok(await clerk.get(`/api/sales-invoice/skus?gudang=${s.m.gudang._id}&search=${s.sku.sku}`));
  assert.equal(found[0].qty, 10);
  assert.equal(found[0].avgCost, undefined);
  assert.equal((await clerk.post(`/api/sales-invoice/${draft._id}/post`)).status, 403);
  assert.equal((await clerk.post('/api/sales-invoice', draftBody(s, { gudang: B._id }))).status, 403);

  ok(await admin.post(`/api/sales-invoice/${draft._id}/post`));
  const list = ok(await clerk.get('/api/sales-invoice'));
  assert.equal(list.canSeeCost, false);
  assert.ok(list.dataSalesInvoice.every((d) => d.cogs === undefined && d.grossProfit === undefined));
  const adminList = ok(await admin.get('/api/sales-invoice?status=POSTED'));
  assert.equal(adminList.dataSalesInvoice[0].grossProfit, 60000); // dpp 180.000 - HPP 120.000

  // dashboard: penjualan hari ini (dpp) & terlaris
  const dash = ok(await admin.get('/api/dashboard?tz=Asia/Jakarta'));
  assert.equal(dash.sales.today.value, 180000);
  assert.equal(dash.sales.today.grossProfit, 60000);
  assert.equal(dash.topProducts[0].qty, 2);
  const clerkDash = ok(await clerk.get('/api/dashboard'));
  assert.equal(clerkDash.sales.today.grossProfit, undefined);
});
