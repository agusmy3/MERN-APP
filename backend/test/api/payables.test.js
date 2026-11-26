const { test } = require('node:test');
const assert = require('node:assert/strict');
const { useTestApp } = require('../helpers/setup');
const { ok, createMasters, createProduct } = require('../helpers/factory');

const t = useTestApp();
const balanceOf = async (sku, gudang) => (await t.model('StockBalance').findOne({ sku, gudang }).lean())?.qty ?? 0;
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

/** PO terbit PCS @10.000 (PPN 11% dari setting, PKP) */
const issuePo = async (admin, m, sku, qty = 10) => ok(await admin.post('/api/purchase-order', {
  vendor: m.vendor._id, gudang: m.gudang._id, issue: true,
  lines: [{ sku: sku._id, uomBeli: m.pcs._id, konversi: 1, qty, hargaBeli: 10000 }],
}), 201);

const receive = async (admin, po, qty, extra = {}) => {
  const gr = ok(await admin.post('/api/goods-receipt', { purchaseOrder: po._id, lines: [{ poLine: po.lines[0]._id, qty }], ...extra }), 201);
  ok(await admin.post(`/api/goods-receipt/${gr._id}/post`, {}));
  return gr;
};

test('vendor bill: from goods receipts (locked PO price + PPN), freight billed by expedition vendor, payments, cancel rules, aging', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const sku = await createProduct(admin, m, 'Bill A');
  ok(await admin.put(`/api/vendor/${m.vendor._id}`, { termDays: 30 }));
  const exp = ok(await admin.post('/api/vendor', { companyName: 'Ekspedisi Cepat', picName: 'E', picContact: '1', companyAddress: 'Jl. E' }), 201);

  const po = await issuePo(admin, m, sku);
  const gr1 = await receive(admin, po, 4);
  const gr2 = await receive(admin, po, 3, { freightCharge: 7000, freightVendor: exp._id, freightNote: 'Truk' });

  const billable = ok(await admin.get(`/api/purchase-invoice/billable?vendor=${m.vendor._id}`));
  assert.deepEqual(billable.goods.map((g) => g.amount), [44400, 33300]);
  assert.equal(billable.freight.length, 0); // angkut GR2 ditagih ekspedisi
  const expBillable = ok(await admin.get(`/api/purchase-invoice/billable?vendor=${exp._id}`));
  assert.equal(expBillable.freight[0].amount, 7000);

  const bill = ok(await admin.post('/api/purchase-invoice', { vendor: m.vendor._id, goodsReceipts: [gr1._id, gr2._id], vendorInvoiceNo: 'FV-001', date: day(0) }), 201);
  assert.match(bill.no, /^BILL-\d{6}-\d{4}$/);
  assert.equal(bill.subtotal, 70000);
  assert.equal(bill.taxAmount, 7700);
  assert.equal(bill.total, 77700);
  assert.equal(bill.paymentStatus, 'UNPAID');
  assert.equal(Math.round((new Date(bill.dueDate) - new Date(new Date(bill.date).setHours(0, 0, 0, 0))) / 86400000), 30);
  assert.match((await admin.post('/api/purchase-invoice', { vendor: m.vendor._id, goodsReceipts: [gr1._id] })).message, /already billed/);
  assert.match((await admin.post('/api/purchase-invoice', { vendor: exp._id, goodsReceipts: [gr1._id] })).message, /not from/);
  assert.match((await admin.post(`/api/goods-receipt/${gr1._id}/cancel`, { reason: 'x' })).message, /billed/);
  assert.equal(ok(await admin.get('/api/goods-receipt?billed=false')).dataGoodsReceipt.length, 0);

  const fbill = ok(await admin.post('/api/purchase-invoice', { vendor: exp._id, freightReceipts: [gr2._id] }), 201);
  assert.equal(fbill.total, 7000);
  assert.equal(fbill.taxAmount, 0);
  assert.equal(String(ok(await admin.get(`/api/goods-receipt/${gr2._id}`)).freightInvoice._id), String(fbill._id));

  // pembayaran bertahap
  const p1 = ok(await admin.post('/api/vendor-payment', { purchaseInvoice: bill._id, method: 'TRANSFER', amount: 50000, reference: 'TRF-1' }), 201);
  assert.match(p1.no, /^VPAY-/);
  assert.equal(ok(await admin.get(`/api/purchase-invoice/${bill._id}`)).paymentStatus, 'PARTIAL');
  assert.match((await admin.post('/api/vendor-payment', { purchaseInvoice: bill._id, method: 'CASH', amount: 30000 })).message, /exceeds/);
  ok(await admin.post('/api/vendor-payment', { purchaseInvoice: bill._id, method: 'CASH', amount: 27700 }), 201);
  let detail = ok(await admin.get(`/api/purchase-invoice/${bill._id}`));
  assert.equal(detail.paymentStatus, 'PAID');
  assert.equal(detail.payments.length, 2);
  assert.equal(ok(await admin.get(`/api/vendor-payment?purchaseInvoice=${bill._id}`)).totalNet, 77700);

  // tidak bisa dibatalkan selama ada pembayaran
  assert.match((await admin.post(`/api/purchase-invoice/${bill._id}/cancel`, { reason: 'x' })).message, /payment/);
  for (const p of detail.payments) ok(await admin.post(`/api/vendor-payment/${p._id}/cancel`, { reason: 'Salah input' }));
  ok(await admin.post(`/api/purchase-invoice/${bill._id}/cancel`, { reason: 'Faktur salah' }));
  assert.equal(ok(await admin.get(`/api/goods-receipt/${gr1._id}`)).purchaseInvoice, null);
  assert.equal(ok(await admin.get('/api/goods-receipt?billed=false')).dataGoodsReceipt.length, 2);

  // umur hutang: tagihan angkut lewat jatuh tempo 40 hari
  await t.model('PurchaseInvoice').updateOne({ _id: fbill._id }, { dueDate: new Date(Date.now() - 40 * 86400000) });
  const aging = ok(await admin.get('/api/purchase-invoice/aging'));
  assert.equal(aging.totals.d31_60, 7000);
  assert.equal(ok(await admin.get('/api/purchase-invoice?paymentStatus=OVERDUE')).dataPurchaseInvoice.length, 1);
  const dash = ok(await admin.get('/api/dashboard'));
  assert.equal(dash.payables.outstanding, 7000);
  assert.equal(dash.payables.overdue, 7000);

  // izin: tagihan butuh juga vendorPrice:view
  const noCost = await t.loginAs({ purchaseInvoice: ['view', 'create'], vendorPayment: ['view'] }, 'NoCost');
  assert.equal((await noCost.get('/api/purchase-invoice')).status, 403);
  assert.equal((await noCost.get('/api/vendor-payment')).status, 403);
  const logs = await t.model('AuditLog').countDocuments({ entity: 'purchaseInvoice', entityId: bill._id });
  assert.ok(logs >= 2);
});

test('purchase return: stock out at receipt cost, before / after billing, replacement reopens PO, cancel rules', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const sku = await createProduct(admin, m, 'Retur A');
  const po = await issuePo(admin, m, sku);
  const gr = await receive(admin, po, 10);
  const line = [{ poLine: po.lines[0]._id }];
  const ret = (qty, extra = {}) => admin.post('/api/purchase-return', { goodsReceipt: gr._id, reason: 'Rusak', lines: [{ ...line[0], qty }], ...extra });

  assert.equal((await admin.post('/api/purchase-return', { goodsReceipt: gr._id, lines: [{ ...line[0], qty: 1 }] })).status, 400); // alasan wajib
  assert.match((await ret(11)).message, /exceeds/);

  // sebelum ditagih: 2 pcs -> tagihan nanti hanya 8
  const r1 = ok(await ret(2), 201);
  assert.match(r1.no, /^PRT-/);
  assert.equal(r1.total, 22200);
  assert.match((await admin.post('/api/purchase-invoice', { vendor: m.vendor._id, goodsReceipts: [gr._id] })).message, /draft purchase return/);
  ok(await admin.post(`/api/purchase-return/${r1._id}/post`));
  assert.equal(await balanceOf(sku._id, m.gudang._id), 8);
  const mv = await t.model('StockMovement').findOne({ refId: r1._id }).lean();
  assert.equal(mv.type, 'PURCHASE_RETURN');
  assert.equal(mv.unitCost, 10000);
  assert.match((await admin.post(`/api/goods-receipt/${gr._id}/cancel`, { reason: 'x' })).message, /purchase return/);

  const bill = ok(await admin.post('/api/purchase-invoice', { vendor: m.vendor._id, goodsReceipts: [gr._id] }), 201);
  assert.equal(bill.lines[0].qty, 8);
  assert.equal(bill.total, 88800);
  assert.match((await admin.post(`/api/purchase-return/${r1._id}/cancel`, { reason: 'x' })).message, /billed after/);

  // setelah ditagih: potong tagihan
  const r2 = ok(await ret(1), 201);
  ok(await admin.post(`/api/purchase-return/${r2._id}/post`));
  let b = ok(await admin.get(`/api/purchase-invoice/${bill._id}`));
  assert.equal(b.returnedAmount, 11100);
  assert.equal(b.balance, 77700);
  assert.equal(b.returns.length, 2);
  ok(await admin.post(`/api/purchase-return/${r2._id}/cancel`, { reason: 'Batal retur' }));
  b = ok(await admin.get(`/api/purchase-invoice/${bill._id}`));
  assert.equal(b.returnedAmount, 0);
  assert.equal(await balanceOf(sku._id, m.gudang._id), 8);

  // minta ganti: PO terbuka lagi, barang pengganti lewat GR baru
  const r3 = ok(await ret(3, { resolution: 'REPLACE' }), 201);
  ok(await admin.post(`/api/purchase-return/${r3._id}/post`));
  let poNow = ok(await admin.get(`/api/purchase-order/${po._id}`));
  assert.equal(poNow.status, 'PARTIAL');
  assert.equal(poNow.lines[0].qtyReceived, 7);
  assert.equal(ok(await admin.get(`/api/purchase-invoice/${bill._id}`)).returnedAmount, 33300);
  await receive(admin, po, 3);
  poNow = ok(await admin.get(`/api/purchase-order/${po._id}`));
  assert.equal(poNow.status, 'RECEIVED');
  assert.match((await admin.post(`/api/purchase-return/${r3._id}/cancel`, { reason: 'x' })).message, /Replacement goods/);
  assert.equal(await balanceOf(sku._id, m.gudang._id), 8);

  // data biaya disembunyikan dari gudang tanpa vendorPrice:view
  const wh = await t.loginAs({ purchaseReturn: ['view', 'create', 'update', 'delete', 'post'] }, 'Gudang Retur');
  const hidden = ok(await wh.get(`/api/purchase-return/${r3._id}`));
  assert.equal(hidden.total, undefined);
  assert.equal(hidden.lines[0].unitCost, undefined);
  assert.ok(ok(await wh.get('/api/purchase-return/gr-options')).some((g) => String(g._id) === String(gr._id)));
});
