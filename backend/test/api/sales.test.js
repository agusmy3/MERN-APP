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

// ---------------------------------------------------------------- retur

/** invoice POSTED: 4 x 100.000 (HPP 60.000), diskon dokumen 40.000, PPN 11% -> dpp 360.000, total 399.600 */
async function postedInvoice(admin, s) {
  const inv = ok(await admin.post('/api/sales-invoice', draftBody(s, {
    discountAmount: 40000, lines: [{ sku: s.sku._id, qty: 4, hargaJual: 100000 }],
  })), 201);
  ok(await admin.post(`/api/sales-invoice/${inv._id}/post`));
  return inv;
}

test('sales return: proportional value, stock back at sold cost, limits, invoice balance', async () => {
  const admin = await t.loginAs();
  const s = await setup(admin);
  const inv = await postedInvoice(admin, s);
  assert.equal(await balanceOf(s.sku._id, s.m.gudang._id), 6);
  const dash0 = ok(await admin.get('/api/dashboard?tz=Asia/Jakarta')).sales.today;
  const opts = ok(await admin.get('/api/sales-return/invoice-options'));
  assert.ok(opts.some((o) => o._id === inv._id));
  const from = ok(await admin.get(`/api/sales-return/from-invoice/${inv._id}`));
  assert.equal(from.lines[0].returnable, 4);
  assert.equal(from.lines[0].unitAmount, 99900); // 100.000 x 399.600 / 400.000

  const body = (qty) => ({ salesInvoice: inv._id, reason: 'Cacat produksi', lines: [{ sku: s.sku._id, qty }] });
  assert.equal((await admin.post('/api/sales-return', body(5))).status, 400);              // > terjual
  assert.equal((await admin.post('/api/sales-return', { ...body(1), reason: '' })).status, 400); // alasan wajib
  const r1 = ok(await admin.post('/api/sales-return', body(1)), 201);
  assert.match(r1.no, /^RTN-\d{6}-\d{4}$/);
  assert.equal(r1.total, 99900);
  assert.equal(r1.dpp, 90000);
  assert.equal(await balanceOf(s.sku._id, s.m.gudang._id), 6); // draft tidak mengubah stok

  const p1 = ok(await admin.post(`/api/sales-return/${r1._id}/post`));
  assert.equal(p1.cogs, 60000);
  assert.equal(await balanceOf(s.sku._id, s.m.gudang._id), 7);
  const mv = await t.model('StockMovement').findOne({ refId: r1._id, type: 'SALE_RETURN' }).lean();
  assert.equal(mv.qty, 1);
  assert.equal(mv.unitCost, 60000);
  let invDoc = ok(await admin.get(`/api/sales-invoice/${inv._id}`));
  assert.equal(invDoc.lines[0].qtyReturned, 1);
  assert.equal(invDoc.returnedAmount, 99900);
  assert.equal(invDoc.balance, 399600 - 99900);
  assert.equal(invDoc.paymentStatus, 'UNPAID');
  assert.equal(invDoc.returns.length, 1);

  // sisa yang bisa diretur = 3; invoice tidak bisa dibatalkan selama ada retur
  assert.equal((await admin.post('/api/sales-return', body(4))).status, 400);
  const blocked = await admin.post(`/api/sales-invoice/${inv._id}/cancel`, { reason: 'x' });
  assert.equal(blocked.status, 400);
  assert.match(blocked.message, /sales return/);

  // retur sisanya: total retur = total invoice persis
  const r2 = ok(await admin.post('/api/sales-return', body(3)), 201);
  ok(await admin.post(`/api/sales-return/${r2._id}/post`));
  invDoc = ok(await admin.get(`/api/sales-invoice/${inv._id}`));
  assert.equal(invDoc.returnedAmount, 399600);
  assert.equal(invDoc.balance, 0);
  const none = ok(await admin.get('/api/sales-return/invoice-options'));
  assert.ok(!none.some((o) => o._id === inv._id));

  // batal retur: stok keluar lagi, retur di invoice berkurang
  ok(await admin.post(`/api/sales-return/${r2._id}/cancel`, { reason: 'Salah input' }));
  assert.equal(await balanceOf(s.sku._id, s.m.gudang._id), 7);
  invDoc = ok(await admin.get(`/api/sales-invoice/${inv._id}`));
  assert.equal(invDoc.lines[0].qtyReturned, 1);
  assert.equal(invDoc.returnedAmount, 99900);
  assert.equal((await skuDoc(s.sku._id)).avgCost, 60000);

  // dashboard: penjualan bersih berkurang sebesar dpp retur yang masih POSTED (90.000, HPP 60.000)
  const dash = ok(await admin.get('/api/dashboard?tz=Asia/Jakarta')).sales.today;
  assert.equal(dash.value, dash0.value - 90000);
  assert.equal(dash.grossProfit, dash0.grossProfit - 30000);
  assert.equal(dash.count, dash0.count);

  // histori invoice memuat retur
  const hist = ok(await admin.get(`/api/audit-log/history?entity=salesInvoice&id=${inv._id}`));
  assert.ok(hist.logs.some((l) => l.entity === 'salesReturn'));
});

test('sales return: permissions & cost hidden', async () => {
  const admin = await t.loginAs();
  const s = await setup(admin);
  const inv = await postedInvoice(admin, s);
  const clerk = await t.loginAs({ salesReturn: ['create', 'update', 'delete'] }, 'Retur Clerk');
  const r = ok(await clerk.post('/api/sales-return', { salesInvoice: inv._id, reason: 'Rusak', lines: [{ sku: s.sku._id, qty: 1 }] }), 201);
  const detail = ok(await clerk.get(`/api/sales-return/${r._id}`));
  assert.equal(detail.lines[0].unitCost, undefined);
  assert.equal(detail.lines[0].returnable, 4);
  assert.equal((await clerk.post(`/api/sales-return/${r._id}/post`)).status, 403);
  const other = await t.loginAs({ salesInvoice: [] });
  assert.equal((await other.get('/api/sales-return')).status, 403);
});

// ---------------------------------------------------------------- pembayaran

test('payments: due date from term, partial / full, refund after return, cancel rules', async () => {
  const admin = await t.loginAs();
  const s = await setup(admin);
  ok(await admin.put(`/api/customer/${s.customer._id}`, { termDays: 30 }));
  assert.equal((await admin.put(`/api/customer/${s.customer._id}`, { termDays: 1.5 })).status, 400);

  const inv = await postedInvoice(admin, s); // total 399.600
  let d = ok(await admin.get(`/api/sales-invoice/${inv._id}`));
  const days = Math.round((new Date(d.dueDate) - new Date(new Date(d.date).setHours(0, 0, 0, 0))) / 86400000);
  assert.equal(days, 30);
  assert.equal(d.paymentStatus, 'UNPAID');
  assert.equal(d.overdue, false);

  const pay = (body) => admin.post('/api/sales-payment', { salesInvoice: inv._id, method: 'TRANSFER', ...body });
  assert.equal((await pay({ amount: 500000 })).status, 400);                 // > sisa
  assert.equal((await pay({ amount: 100, method: 'CHEQUE' })).status, 400); // metode tidak dikenal
  assert.equal((await pay({ amount: 100, type: 'REFUND' })).status, 400);    // belum lebih bayar
  const p1 = ok(await pay({ amount: 100000, reference: 'TRX-1' }), 201);
  assert.match(p1.no, /^PAY-\d{6}-\d{4}$/);
  d = ok(await admin.get(`/api/sales-invoice/${inv._id}`));
  assert.equal(d.paymentStatus, 'PARTIAL');
  assert.equal(d.balance, 299600);
  assert.equal(d.payments.length, 1);

  ok(await pay({ amount: 299600, method: 'CASH' }), 201);
  d = ok(await admin.get(`/api/sales-invoice/${inv._id}`));
  assert.equal(d.paymentStatus, 'PAID');
  assert.equal(d.balance, 0);

  // invoice yang sudah dibayar tidak bisa dibatalkan
  const blocked = await admin.post(`/api/sales-invoice/${inv._id}/cancel`, { reason: 'x' });
  assert.equal(blocked.status, 400);
  assert.match(blocked.message, /payment/);

  // retur setelah lunas -> lebih bayar -> refund
  const r = ok(await admin.post('/api/sales-return', { salesInvoice: inv._id, reason: 'Rusak', lines: [{ sku: s.sku._id, qty: 1 }] }), 201);
  ok(await admin.post(`/api/sales-return/${r._id}/post`));
  d = ok(await admin.get(`/api/sales-invoice/${inv._id}`));
  assert.equal(d.paymentStatus, 'OVERPAID');
  assert.equal(d.balance, -99900);
  assert.equal((await pay({ amount: 100000, type: 'REFUND' })).status, 400); // > kelebihan
  const refund = ok(await pay({ amount: 99900, type: 'REFUND', method: 'CASH' }), 201);
  assert.match(refund.no, /^RFD-/);
  d = ok(await admin.get(`/api/sales-invoice/${inv._id}`));
  assert.equal(d.paymentStatus, 'PAID');
  assert.equal(d.paidAmount, 399600 - 99900);

  // batal pembayaran: tagihan kembali
  assert.equal((await admin.post(`/api/sales-payment/${p1._id}/cancel`, {})).status, 400); // alasan wajib
  ok(await admin.post(`/api/sales-payment/${p1._id}/cancel`, { reason: 'Transfer gagal' }));
  d = ok(await admin.get(`/api/sales-invoice/${inv._id}`));
  assert.equal(d.paymentStatus, 'PARTIAL');
  assert.equal(d.balance, 100000);
  assert.equal((await admin.post(`/api/sales-payment/${p1._id}/cancel`, { reason: 'lagi' })).status, 400);

  // daftar: filter & total bersih; daftar invoice: filter belum lunas
  const list = ok(await admin.get(`/api/sales-payment?salesInvoice=${inv._id}&status=POSTED`));
  assert.equal(list.totalData, 2);
  assert.equal(list.totalNet, 299600 - 99900);
  const open = ok(await admin.get('/api/sales-invoice?paymentStatus=OPEN'));
  assert.ok(open.dataSalesInvoice.some((x) => x._id === inv._id && x.balance === 100000));
  assert.equal(ok(await admin.get('/api/sales-invoice?paymentStatus=OVERDUE')).totalData, 0);

  // jatuh tempo lewat -> overdue; dashboard piutang
  await t.model('SalesInvoice').updateOne({ _id: inv._id }, { dueDate: new Date(Date.now() - 2 * 86400000) });
  assert.ok(ok(await admin.get('/api/sales-invoice?paymentStatus=OVERDUE')).dataSalesInvoice.some((x) => x._id === inv._id));
  const dash = ok(await admin.get('/api/dashboard'));
  assert.ok(dash.receivables.overdue >= 100000);
  assert.ok(dash.receivables.overdueCount >= 1);

  // izin: tanpa salesPayment:create tidak bisa mencatat
  const viewer = await t.loginAs({ salesPayment: [] });
  assert.equal((await viewer.post('/api/sales-payment', { salesInvoice: inv._id, method: 'CASH', amount: 1 })).status, 403);
  assert.equal(ok(await viewer.get('/api/sales-payment')).totalData >= 3, true);
});

// ---------------------------------------------------------------- price list

test('price list: customer price resolution, validation, delete rules, SKU cascade', async () => {
  const admin = await t.loginAs();
  const s = await setup(admin);
  const other = await createProduct(admin, s.m, 'Harga Lain');
  await t.model('ProdukSku').updateMany({ _id: { $in: [s.sku._id, other._id] } }, { hargaJual: 100000 });

  assert.equal((await admin.post('/api/price-list', { code: 'X', name: '' })).status, 400);
  assert.equal((await admin.post('/api/price-list', { code: 'BAD', name: 'Bad', items: [{ sku: s.sku._id, price: -1 }] })).status, 400);
  const pl = ok(await admin.post('/api/price-list', { code: 'grosir', name: 'Grosir', items: [{ sku: s.sku._id, price: 90000 }] }), 201);
  assert.equal(pl.code, 'GROSIR');
  assert.equal((await admin.post('/api/price-list', { code: 'GROSIR', name: 'Dup' })).status, 400);

  // customer tanpa price list -> harga default; dengan price list -> harga list (SKU lain tetap default)
  const search = (customer) => admin.get(`/api/sales-invoice/skus?gudang=${s.m.gudang._id}&search=${s.sku.sku}&customer=${customer}`);
  assert.equal(ok(await search(s.customer._id))[0].hargaJual, 100000);
  ok(await admin.put(`/api/customer/${s.customer._id}`, { priceList: pl._id }));
  const found = ok(await search(s.customer._id))[0];
  assert.equal(found.hargaJual, 90000);
  assert.equal(found.priceSource, 'list');
  const prices = ok(await admin.post('/api/sales-invoice/skus/prices', { customer: s.customer._id, skus: [s.sku._id, other._id] }));
  assert.deepEqual(prices[s.sku._id], { price: 90000, source: 'list' });
  assert.deepEqual(prices[other._id], { price: 100000, source: 'default' });

  // list nonaktif -> harga default
  ok(await admin.put(`/api/price-list/${pl._id}`, { isActive: false }));
  assert.equal(ok(await search(s.customer._id))[0].priceSource, 'default');
  ok(await admin.put(`/api/price-list/${pl._id}`, { isActive: true, items: [{ sku: s.sku._id, price: 85000 }, { sku: other._id, price: 95000 }] }));
  const detail = ok(await admin.get(`/api/price-list/${pl._id}`));
  assert.equal(detail.items.length, 2);
  assert.equal(detail.customers.length, 1);
  const list = ok(await admin.get('/api/price-list'));
  assert.equal(list.dataPriceList.find((x) => x._id === pl._id).customerCount, 1);

  // dipakai customer -> tidak bisa dihapus; lepas dulu
  assert.equal((await admin.del(`/api/price-list/${pl._id}`)).status, 400);
  assert.equal((await admin.put(`/api/customer/${s.customer._id}`, { priceList: s.customer._id })).status, 400); // id bukan price list

  // hapus SKU (tanpa histori) -> item price list ikut hilang
  ok(await admin.del(`/api/produk/${other.produk._id}/sku/${other._id}`));
  assert.equal(ok(await admin.get(`/api/price-list/${pl._id}`)).items.length, 1);

  ok(await admin.put(`/api/customer/${s.customer._id}`, { priceList: '' }));
  ok(await admin.del(`/api/price-list/${pl._id}`));
  const logs = await t.model('AuditLog').find({ entity: 'priceList' }).lean();
  assert.ok(logs.some((l) => l.action === 'delete'));
  const noPerm = await t.loginAs({ salesInvoice: [] });
  assert.equal((await noPerm.get('/api/price-list')).status, 403);
});
