const { test } = require('node:test');
const assert = require('node:assert/strict');
const { useTestApp } = require('../helpers/setup');
const { ok, createMasters, createProduct, postAdjustment } = require('../helpers/factory');

const t = useTestApp();

test('customer receipt: one payment allocated to several invoices, must equal allocations, cancel as a whole', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const sku = await createProduct(admin, m, 'Rcv A');
  await t.model('ProdukSku').updateOne({ _id: sku._id }, { hargaJual: 100000 });
  await postAdjustment(admin, m.gudang._id, [{ sku: sku._id, qtyChange: 20, unitCost: 50000 }], 'OPENING');
  const customer = ok(await admin.post('/api/customer', { name: 'CV Bayar Gabung', termDays: 30 }), 201);
  const sell = async (qty, taxRate = 0) => {
    const d = ok(await admin.post('/api/sales-invoice', { customer: customer._id, gudang: m.gudang._id, taxRate, lines: [{ sku: sku._id, qty }] }), 201);
    return ok(await admin.post(`/api/sales-invoice/${d._id}/post`));
  };
  const i1 = await sell(5); // 500.000
  const i2 = await sell(7); // 700.000
  const i3 = await sell(3); // 300.000
  await t.model('SalesInvoice').updateOne({ _id: i1._id }, { dueDate: new Date(Date.now() - 5 * 86400000) });

  const open = ok(await admin.get(`/api/customer-receipt/open-invoices?customer=${customer._id}`));
  assert.deepEqual(open.map((x) => x.no), [i1.no, i2.no, i3.no]); // jatuh tempo tertua dulu
  assert.equal(open[0].overdue, true);

  const body = (amount, allocations) => ({ customer: customer._id, method: 'TRANSFER', amount, reference: 'TRF-99', allocations });
  // alokasi melebihi uang: ditolak (kelebihan uang = deposit, diuji di deposit.test.js)
  assert.match((await admin.post('/api/customer-receipt', body(900000, [{ invoice: i1._id, amount: 500000 }, { invoice: i2._id, amount: 500000 }]))).message, /exceeds the money available/);
  assert.match((await admin.post('/api/customer-receipt', body(800000, [{ invoice: i3._id, amount: 800000 }]))).message, /exceeds/);
  const other = ok(await admin.post('/api/customer', { name: 'Lain' }), 201);
  assert.match((await admin.post('/api/customer-receipt', { ...body(500000, [{ invoice: i1._id, amount: 500000 }]), customer: other._id })).message, /does not belong/);

  const rcv = ok(await admin.post('/api/customer-receipt', body(1000000, [{ invoice: i1._id, amount: 500000 }, { invoice: i2._id, amount: 500000 }])), 201);
  assert.match(rcv.no, /^RCV-/);
  assert.equal(rcv.allocations.length, 2);
  const inv1 = ok(await admin.get(`/api/sales-invoice/${i1._id}`));
  assert.equal(inv1.paymentStatus, 'PAID');
  assert.equal(inv1.payments[0].batch.no, rcv.no);
  assert.equal(ok(await admin.get(`/api/sales-invoice/${i2._id}`)).paymentStatus, 'PARTIAL');
  const detail = ok(await admin.get(`/api/customer-receipt/${rcv._id}`));
  assert.equal(detail.allocations[1].salesInvoice.no, i2.no);
  assert.equal(ok(await admin.get('/api/customer-receipt')).dataCustomerReceipt.length, 1);
  assert.equal(ok(await admin.get(`/api/sales-payment?customer=${customer._id}`)).totalNet, 1000000);

  // pembayaran alokasi tidak bisa dibatalkan sendiri; invoice berpembayaran tidak bisa dibatalkan
  assert.match((await admin.post(`/api/sales-payment/${inv1.payments[0]._id}/cancel`, { reason: 'x' })).message, /combined payment/);
  assert.match((await admin.post(`/api/sales-invoice/${i1._id}/cancel`, { reason: 'x' })).message, /payment/);

  assert.equal((await admin.post(`/api/customer-receipt/${rcv._id}/cancel`, {})).status, 400);
  ok(await admin.post(`/api/customer-receipt/${rcv._id}/cancel`, { reason: 'Transfer ditolak bank' }));
  assert.equal(ok(await admin.get(`/api/sales-invoice/${i1._id}`)).paymentStatus, 'UNPAID');
  assert.equal(ok(await admin.get(`/api/sales-invoice/${i2._id}`)).paymentStatus, 'UNPAID');
  assert.match((await admin.post(`/api/customer-receipt/${rcv._id}/cancel`, { reason: 'x' })).message, /already cancelled/);

  const viewer = await t.loginAs({ salesPayment: ['view'] }, 'PayViewer');
  assert.equal((await viewer.post('/api/customer-receipt', body(300000, [{ invoice: i3._id, amount: 300000 }]))).status, 403);
  assert.equal((await viewer.get(`/api/customer-receipt/${rcv._id}`)).status, 200);
});

test('vendor payment batch: pay several vendor bills at once (needs cost access), cancel restores balances', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const sku = await createProduct(admin, m, 'VPB A');
  const po = ok(await admin.post('/api/purchase-order', {
    vendor: m.vendor._id, gudang: m.gudang._id, issue: true,
    lines: [{ sku: sku._id, uomBeli: m.pcs._id, konversi: 1, qty: 10, hargaBeli: 10000 }],
  }), 201);
  const receiveAndBill = async (qty) => {
    const gr = ok(await admin.post('/api/goods-receipt', { purchaseOrder: po._id, lines: [{ poLine: po.lines[0]._id, qty }] }), 201);
    ok(await admin.post(`/api/goods-receipt/${gr._id}/post`, {}));
    return ok(await admin.post('/api/purchase-invoice', { vendor: m.vendor._id, goodsReceipts: [gr._id] }), 201);
  };
  const b1 = await receiveAndBill(4); // 44.400
  const b2 = await receiveAndBill(6); // 66.600

  const open = ok(await admin.get(`/api/vendor-payment-batch/open-invoices?vendor=${m.vendor._id}`));
  assert.deepEqual(open.map((x) => x.balance), [44400, 66600]);
  const batch = ok(await admin.post('/api/vendor-payment-batch', {
    vendor: m.vendor._id, method: 'TRANSFER', amount: 111000, allocations: [{ invoice: b1._id, amount: 44400 }, { invoice: b2._id, amount: 66600 }],
  }), 201);
  assert.match(batch.no, /^VPB-/);
  assert.equal(ok(await admin.get(`/api/purchase-invoice/${b2._id}`)).paymentStatus, 'PAID');
  const pays = ok(await admin.get(`/api/vendor-payment?vendor=${m.vendor._id}`));
  assert.equal(pays.totalNet, 111000);
  assert.equal(pays.dataVendorPayment[0].batch.no, batch.no);
  assert.match((await admin.post(`/api/vendor-payment/${pays.dataVendorPayment[0]._id}/cancel`, { reason: 'x' })).message, /combined payment/);

  const noCost = await t.loginAs({ vendorPayment: ['view', 'create', 'update'] }, 'NoCostBatch');
  assert.equal((await noCost.get('/api/vendor-payment-batch')).status, 403);

  ok(await admin.post(`/api/vendor-payment-batch/${batch._id}/cancel`, { reason: 'Salah rekening' }));
  assert.equal(ok(await admin.get(`/api/purchase-invoice/${b1._id}`)).paymentStatus, 'UNPAID');
  assert.equal(ok(await admin.get(`/api/vendor-payment-batch/${batch._id}`)).status, 'CANCELLED');
  assert.ok(await t.model('AuditLog').exists({ entity: 'vendorPaymentBatch', entityId: batch._id }));
});
