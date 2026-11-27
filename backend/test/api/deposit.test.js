const { test } = require('node:test');
const assert = require('node:assert/strict');
const { useTestApp } = require('../helpers/setup');
const { ok, createMasters, createProduct, postAdjustment } = require('../helpers/factory');

const t = useTestApp();

/** master + SKU harga 100.000 (tanpa PPN) + customer; sell(qty) -> invoice POSTED */
async function salesSetup(admin, name) {
  const m = await createMasters(admin);
  const sku = await createProduct(admin, m, `${name} ${Date.now()}`);
  await t.model('ProdukSku').updateOne({ _id: sku._id }, { hargaJual: 100000 });
  await postAdjustment(admin, m.gudang._id, [{ sku: sku._id, qtyChange: 100, unitCost: 50000 }], 'OPENING');
  const customer = ok(await admin.post('/api/customer', { name: `${name} Customer`, termDays: 30 }), 201);
  const sell = async (qty) => {
    const d = ok(await admin.post('/api/sales-invoice', { customer: customer._id, gudang: m.gudang._id, taxRate: 0, lines: [{ sku: sku._id, qty }] }), 201);
    return ok(await admin.post(`/api/sales-invoice/${d._id}/post`));
  };
  return { m, sku, customer, sell };
}
const inv = (c, id) => c.get(`/api/sales-invoice/${id}`).then((r) => ok(r));

test('write-off on a payment: balance & status, limit and bad debt need approve, cancel restores', async () => {
  const admin = await t.loginAs();
  const s = await salesSetup(admin, 'WO');
  const i1 = await s.sell(1); // 100.000

  // kasir pembayaran biasa (tanpa approve): potongan <= batas setting (default 10.000)
  const clerk = await t.loginAs({ salesPayment: ['create', 'update'], salesInvoice: [] }, 'Clerk WO');
  assert.match((await clerk.post('/api/sales-payment', { salesInvoice: i1._id, method: 'TRANSFER', amount: 80000, writeOffAmount: 20000, writeOffReason: 'DISCOUNT' })).message, /above the limit/);
  assert.match((await clerk.post('/api/sales-payment', { salesInvoice: i1._id, method: 'TRANSFER', amount: 99000, writeOffAmount: 1000 })).message, /write-off reason/);
  assert.match((await clerk.post('/api/sales-payment', { salesInvoice: i1._id, method: 'TRANSFER', amount: 99000, writeOffAmount: 2000, writeOffReason: 'BANK_FEE' })).message, /exceeds the outstanding/);
  const p1 = ok(await clerk.post('/api/sales-payment', { salesInvoice: i1._id, method: 'TRANSFER', amount: 99500, writeOffAmount: 500, writeOffReason: 'BANK_FEE' }), 201);
  let d = await inv(admin, i1._id);
  assert.deepEqual([d.paymentStatus, d.paidAmount, d.writtenOffAmount, d.balance], ['PAID', 99500, 500, 0]);
  assert.equal(d.payments[0].writeOffReason, 'BANK_FEE');
  assert.equal(ok(await admin.get(`/api/sales-payment?salesInvoice=${i1._id}`)).totalNet, 99500); // potongan bukan uang
  ok(await clerk.post(`/api/sales-payment/${p1._id}/cancel`, { reason: 'salah' }));
  d = await inv(admin, i1._id);
  assert.deepEqual([d.paymentStatus, d.paidAmount, d.writtenOffAmount], ['UNPAID', 0, 0]);

  // piutang tak tertagih: selalu butuh approve; hanya potongan (tanpa uang)
  assert.equal((await clerk.post('/api/sales-payment', { salesInvoice: i1._id, writeOffAmount: 5000, writeOffReason: 'BAD_DEBT' })).status, 403);
  const finance = await t.loginAs({ salesPayment: ['create', 'update', 'approve'] }, 'Finance WO');
  const bad = ok(await finance.post('/api/sales-payment', { salesInvoice: i1._id, writeOffAmount: 100000, writeOffReason: 'BAD_DEBT', note: 'Toko tutup' }), 201);
  assert.equal(bad.amount, 0);
  assert.equal(bad.method, null);
  d = await inv(admin, i1._id);
  assert.deepEqual([d.paymentStatus, d.writtenOffAmount], ['PAID', 100000]);
  assert.ok(await t.model('AuditLog').exists({ entity: 'salesPayment', entityId: bad._id }));
  // laporan: penjualan bersih tidak berubah, potongan tampil terpisah
  const today = new Date().toLocaleDateString('en-CA');
  const rep = ok(await admin.get(`/api/sales-report/sales?from=${today}&to=${today}&customer=${s.customer._id}`)).totals;
  assert.deepEqual([rep.net, rep.writeOff, rep.badDebt], [100000, 100000, 100000]);

  // batas 0 = semua potongan butuh approve
  ok(await admin.put('/api/setting', { values: { 'payment.writeOffLimit': 0 } }));
  const i2 = await s.sell(1);
  assert.equal((await clerk.post('/api/sales-payment', { salesInvoice: i2._id, method: 'CASH', amount: 99900, writeOffAmount: 100, writeOffReason: 'ROUNDING' })).status, 403);
  ok(await admin.put('/api/setting', { values: { 'payment.writeOffLimit': 10000 } }));
});

test('customer deposit: down payment, pay invoices from it, refund, cancel rules, credit exposure', async () => {
  const admin = await t.loginAs();
  const s = await salesSetup(admin, 'DP');
  const walkIn = await t.model('Customer').findOne({ isWalkIn: true }).lean()
    || ok(await admin.post('/api/customer', { name: 'Walk', isWalkIn: true }), 201);
  if (walkIn.isWalkIn) assert.match((await admin.post('/api/customer-deposit', { customer: walkIn._id, method: 'CASH', amount: 1000 })).message, /walk-in/);

  const dep = ok(await admin.post('/api/customer-deposit', { customer: s.customer._id, method: 'TRANSFER', amount: 250000, reference: 'DP-1' }), 201);
  assert.match(dep.no, /^DEP-/);
  assert.equal(dep.source, 'DIRECT');

  // posisi kredit: deposit mengurangi pemakaian
  const i1 = await s.sell(2); // 200.000
  let credit = ok(await admin.get(`/api/customer/${s.customer._id}`)).credit;
  assert.deepEqual([credit.receivable, credit.deposit, credit.exposure], [200000, 250000, -50000]);

  // bayar dari deposit (tunggal)
  assert.match((await admin.post('/api/sales-payment', { salesInvoice: i1._id, method: 'DEPOSIT', amount: 50000 })).message, /deposit/i);
  const pay = ok(await admin.post('/api/sales-payment', { salesInvoice: i1._id, method: 'DEPOSIT', deposit: dep._id, amount: 150000 }), 201);
  let dd = ok(await admin.get(`/api/customer-deposit/${dep._id}`));
  assert.deepEqual([dd.usedAmount, dd.balance, dd.usages.length], [150000, 100000, 1]);
  assert.match((await admin.post('/api/sales-payment', { salesInvoice: i1._id, method: 'DEPOSIT', deposit: dep._id, amount: 50000.01 })).message, /exceeds/);
  assert.match((await admin.post(`/api/customer-deposit/${dep._id}/cancel`, { reason: 'x' })).message, /used/);
  ok(await admin.post(`/api/sales-payment/${pay._id}/cancel`, { reason: 'salah' }));
  assert.equal(ok(await admin.get(`/api/customer-deposit/${dep._id}`)).balance, 250000);

  // pakai untuk beberapa invoice sekaligus
  const i2 = await s.sell(1);
  ok(await admin.post(`/api/customer-deposit/${dep._id}/apply`, { allocations: [{ invoice: i1._id, amount: 200000 }, { invoice: i2._id, amount: 50000 }] }));
  assert.equal((await inv(admin, i1._id)).paymentStatus, 'PAID');
  assert.equal((await inv(admin, i2._id)).balance, 50000);
  assert.equal(ok(await admin.get(`/api/customer-deposit/${dep._id}`)).balance, 0);
  assert.match((await admin.post(`/api/customer-deposit/${dep._id}/apply`, { allocations: [{ invoice: i2._id, amount: 1 }] })).message, /exceeds the deposit balance/);
  assert.equal(ok(await admin.get(`/api/customer-deposit/open?customer=${s.customer._id}`)).length, 0);

  // refund deposit
  const dep2 = ok(await admin.post('/api/customer-deposit', { customer: s.customer._id, method: 'CASH', amount: 30000 }), 201);
  assert.match((await admin.post(`/api/customer-deposit/${dep2._id}/refund`, { method: 'CASH', amount: 40000 })).message, /exceeds/);
  const r = ok(await admin.post(`/api/customer-deposit/${dep2._id}/refund`, { method: 'CASH', amount: 10000, note: 'diminta kembali' }));
  assert.equal(r.refundedAmount, 10000);
  assert.match((await admin.post(`/api/customer-deposit/${dep2._id}/cancel`, { reason: 'x' })).message, /refunds/);
  ok(await admin.post(`/api/customer-deposit/${dep2._id}/refunds/${r.refunds[0]._id}/cancel`, { reason: 'batal' }));
  ok(await admin.post(`/api/customer-deposit/${dep2._id}/cancel`, { reason: 'input salah' }));
  const list = ok(await admin.get(`/api/customer-deposit?customer=${s.customer._id}`));
  assert.equal(list.dataCustomerDeposit.length, 2);
  assert.equal(list.totalBalance, 0);
  assert.equal(ok(await admin.get(`/api/customer-deposit?customer=${s.customer._id}&hasBalance=true`)).dataCustomerDeposit.length, 0);

  const viewer = await t.loginAs({ salesPayment: ['view'] }, 'DepViewer');
  assert.equal((await viewer.post('/api/customer-deposit', { customer: s.customer._id, method: 'CASH', amount: 1 })).status, 403);
});

test('combined receipt with deposits, write-offs and overpayment to a new deposit; cancel reverses everything', async () => {
  const admin = await t.loginAs();
  const s = await salesSetup(admin, 'MIX');
  const a = await s.sell(3); // 300.000
  const b = await s.sell(2); // 200.000
  const old = ok(await admin.post('/api/customer-deposit', { customer: s.customer._id, method: 'CASH', amount: 50000 }), 201);

  const body = {
    customer: s.customer._id, method: 'TRANSFER', amount: 460000, deposits: [{ deposit: old._id, amount: 50000 }],
    allocations: [{ invoice: a._id, amount: 300000 }, { invoice: b._id, amount: 199000, writeOff: 1000, writeOffReason: 'BANK_FEE' }],
  };
  assert.match((await admin.post('/api/customer-receipt', { ...body, deposits: [{ deposit: old._id, amount: 60000 }] })).message, /deposit balance/);
  const rcv = ok(await admin.post('/api/customer-receipt', body), 201);
  // dana 510.000, teralokasi 499.000 -> 11.000 jadi deposit baru
  assert.ok(rcv.depositCreated);
  const created = ok(await admin.get(`/api/customer-deposit/${rcv.depositCreated}`));
  assert.deepEqual([created.amount, created.source], [11000, 'BATCH']);
  assert.equal((await inv(admin, a._id)).paymentStatus, 'PAID');
  const ib = await inv(admin, b._id);
  assert.deepEqual([ib.paymentStatus, ib.paidAmount, ib.writtenOffAmount], ['PAID', 199000, 1000]);
  // invoice A dibayar 50.000 dari deposit lama + 250.000 uang baru
  const ia = await inv(admin, a._id);
  assert.deepEqual(ia.payments.map((p) => [p.method, p.amount]), [['DEPOSIT', 50000], ['TRANSFER', 250000]]);
  assert.equal(ok(await admin.get(`/api/customer-deposit/${old._id}`)).balance, 0);
  assert.match((await admin.post(`/api/customer-deposit/${rcv.depositCreated}/cancel`, { reason: 'x' })).message, /combined payment/);

  // deposit hasil kelebihan sudah dipakai -> pembayaran gabungan tidak bisa dibatalkan
  const c = await s.sell(1);
  const use = ok(await admin.post('/api/sales-payment', { salesInvoice: c._id, method: 'DEPOSIT', deposit: rcv.depositCreated, amount: 11000 }), 201);
  assert.match((await admin.post(`/api/customer-receipt/${rcv._id}/cancel`, { reason: 'x' })).message, /used or refunded/);
  ok(await admin.post(`/api/sales-payment/${use._id}/cancel`, { reason: 'x' }));
  ok(await admin.post(`/api/customer-receipt/${rcv._id}/cancel`, { reason: 'transfer ditolak' }));
  assert.equal((await inv(admin, a._id)).paymentStatus, 'UNPAID');
  const ib2 = await inv(admin, b._id);
  assert.deepEqual([ib2.paymentStatus, ib2.writtenOffAmount], ['UNPAID', 0]);
  assert.equal(ok(await admin.get(`/api/customer-deposit/${old._id}`)).balance, 50000);
  assert.equal(ok(await admin.get(`/api/customer-deposit/${rcv.depositCreated}`)).status, 'CANCELLED');

  // hanya kelebihan (tanpa invoice) & hanya potongan juga sah
  const onlyDep = ok(await admin.post('/api/customer-receipt', { customer: s.customer._id, method: 'CASH', amount: 5000, allocations: [] }), 201);
  assert.ok(onlyDep.depositCreated);
  ok(await admin.post('/api/customer-receipt', { customer: s.customer._id, amount: 0, allocations: [{ invoice: b._id, amount: 0, writeOff: 500, writeOffReason: 'ROUNDING' }] }), 201);
  assert.equal((await inv(admin, b._id)).writtenOffAmount, 500);
});

test('overpaid invoice: move the overpayment to a deposit; cancelling the deposit restores the overpayment', async () => {
  const admin = await t.loginAs();
  const s = await salesSetup(admin, 'OVR');
  const i1 = await s.sell(2); // 200.000
  ok(await admin.post('/api/sales-payment', { salesInvoice: i1._id, method: 'CASH', amount: 200000 }), 201);
  const lineId = (await inv(admin, i1._id)).lines[0]._id;
  const ret = ok(await admin.post('/api/sales-return', { salesInvoice: i1._id, reason: 'Rusak', lines: [{ invoiceLine: lineId, qty: 1 }] }), 201);
  ok(await admin.post(`/api/sales-return/${ret._id}/post`));
  let d = await inv(admin, i1._id);
  assert.deepEqual([d.paymentStatus, d.balance], ['OVERPAID', -100000]);

  assert.match((await admin.post('/api/customer-deposit/from-invoice', { salesInvoice: i1._id, amount: 150000 })).message, /exceeds/);
  const dep = ok(await admin.post('/api/customer-deposit/from-invoice', { salesInvoice: i1._id }), 201);
  assert.deepEqual([dep.amount, dep.source], [100000, 'OVERPAYMENT']);
  d = await inv(admin, i1._id);
  assert.deepEqual([d.paymentStatus, d.balance], ['PAID', 0]);
  const refund = d.payments.find((p) => p.type === 'REFUND');
  assert.equal(refund.method, 'DEPOSIT');
  assert.match((await admin.post(`/api/sales-payment/${refund._id}/cancel`, { reason: 'x' })).message, /Cancel that deposit/);
  assert.match((await admin.post('/api/customer-deposit/from-invoice', { salesInvoice: i1._id })).message, /not overpaid/);

  ok(await admin.post(`/api/customer-deposit/${dep._id}/cancel`, { reason: 'refund tunai saja' }));
  d = await inv(admin, i1._id);
  assert.deepEqual([d.paymentStatus, d.balance], ['OVERPAID', -100000]);
});

test('vendor side: down payment to vendor, pay a bill from it with a vendor discount; other reason needs a note', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const sku = await createProduct(admin, m, `VDP ${Date.now()}`);
  const po = ok(await admin.post('/api/purchase-order', {
    vendor: m.vendor._id, gudang: m.gudang._id, issue: true,
    lines: [{ sku: sku._id, uomBeli: m.pcs._id, konversi: 1, qty: 10, hargaBeli: 10000 }],
  }), 201);
  const dep = ok(await admin.post('/api/vendor-deposit', { vendor: m.vendor._id, purchaseOrder: po._id, method: 'TRANSFER', amount: 50000 }), 201);
  assert.match(dep.no, /^VDP-/);
  const gr = ok(await admin.post('/api/goods-receipt', { purchaseOrder: po._id, lines: [{ poLine: po.lines[0]._id, qty: 10 }] }), 201);
  ok(await admin.post(`/api/goods-receipt/${gr._id}/post`, {}));
  const bill = ok(await admin.post('/api/purchase-invoice', { vendor: m.vendor._id, goodsReceipts: [gr._id] }), 201);
  const total = bill.total;

  ok(await admin.post('/api/vendor-payment', { purchaseInvoice: bill._id, method: 'DEPOSIT', deposit: dep._id, amount: 50000 }), 201);
  assert.match((await admin.post('/api/vendor-payment', { purchaseInvoice: bill._id, method: 'TRANSFER', amount: 1000, writeOffAmount: 100, writeOffReason: 'OTHER' })).message, /needs a note/);
  assert.match((await admin.post('/api/vendor-payment', { purchaseInvoice: bill._id, method: 'TRANSFER', amount: 1000, writeOffAmount: 100, writeOffReason: 'BAD_DEBT' })).message, /write-off reason/);
  ok(await admin.post('/api/vendor-payment', { purchaseInvoice: bill._id, method: 'TRANSFER', amount: total - 50000 - 400, writeOffAmount: 400, writeOffReason: 'DISCOUNT' }), 201);
  const b = ok(await admin.get(`/api/purchase-invoice/${bill._id}`));
  assert.deepEqual([b.paymentStatus, b.writtenOffAmount, b.balance], ['PAID', 400, 0]);
  assert.equal(ok(await admin.get(`/api/vendor-deposit/${dep._id}`)).balance, 0);

  const noCost = await t.loginAs({ vendorPayment: ['view', 'create'] }, 'NoCostDep');
  assert.equal((await noCost.get('/api/vendor-deposit')).status, 403);
  assert.ok(await t.model('AuditLog').exists({ entity: 'vendorDeposit', entityId: dep._id }));
});

test('deposit write-off (vendor not acknowledging / customer forfeit): approve only, note required, cancel; aging alerts', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const vdep = ok(await admin.post('/api/vendor-deposit', { vendor: m.vendor._id, method: 'TRANSFER', amount: 75000 }), 201);

  const clerk = await t.loginAs({ vendorPayment: ['create', 'update'], vendorPrice: [] }, 'Clerk VDP');
  assert.equal((await clerk.post(`/api/vendor-deposit/${vdep._id}/write-off`, { reason: 'VENDOR_DISPUTE', note: 'x' })).status, 403);
  assert.match((await admin.post(`/api/vendor-deposit/${vdep._id}/write-off`, { reason: 'FORFEITED', note: 'x' })).message, /reason/);
  assert.match((await admin.post(`/api/vendor-deposit/${vdep._id}/write-off`, { reason: 'VENDOR_DISPUTE' })).message, /note is required/);
  assert.match((await admin.post(`/api/vendor-deposit/${vdep._id}/write-off`, { reason: 'VENDOR_DISPUTE', note: 'x', amount: 80000 })).message, /exceeds/);
  const w = ok(await admin.post(`/api/vendor-deposit/${vdep._id}/write-off`, { reason: 'VENDOR_DISPUTE', note: 'Vendor menyangkal transfer 1 Nov' }));
  assert.deepEqual([w.writtenOffAmount, w.writeOffs.length], [75000, 1]);
  let d = ok(await admin.get(`/api/vendor-deposit/${vdep._id}`));
  assert.deepEqual([d.balance, d.writeOffs[0].reason], [0, 'VENDOR_DISPUTE']);
  assert.equal(ok(await admin.get(`/api/vendor-deposit?vendor=${m.vendor._id}&hasBalance=true`)).dataVendorDeposit.length, 0);
  assert.match((await admin.post(`/api/vendor-deposit/${vdep._id}/cancel`, { reason: 'x' })).message, /write-offs/);
  assert.match((await admin.post(`/api/vendor-deposit/${vdep._id}/write-off`, { reason: 'VENDOR_CLOSED', note: 'x' })).message, /no balance/);
  ok(await admin.post(`/api/vendor-deposit/${vdep._id}/write-offs/${d.writeOffs[0]._id}/cancel`, { reason: 'Vendor akhirnya mengakui' }));
  d = ok(await admin.get(`/api/vendor-deposit/${vdep._id}`));
  assert.deepEqual([d.balance, d.writtenOffAmount], [75000, 0]);
  assert.ok(await t.model('AuditLog').exists({ entity: 'vendorDeposit', entityId: vdep._id, 'changes.field': 'writtenOffAmount' }));

  // umur: deposit 90 hari lalu (setting default 60) -> aged + ringkasan dashboard
  await t.model('VendorDeposit').updateOne({ _id: vdep._id }, { date: new Date(Date.now() - 90 * 86400000) });
  const aged = ok(await admin.get(`/api/vendor-deposit?aged=true&vendor=${m.vendor._id}`));
  assert.equal(aged.dataVendorDeposit.length, 1);
  assert.equal(aged.alertDays, 60);
  assert.ok(aged.dataVendorDeposit[0].aged && aged.dataVendorDeposit[0].ageDays >= 89);
  const dash = ok(await admin.get('/api/dashboard'));
  assert.ok(dash.agedDeposits.vendor.count >= 1 && dash.agedDeposits.vendor.amount >= 75000);
  ok(await admin.put('/api/setting', { values: { 'payment.depositAgeAlertDays': 0 } }));
  assert.equal(ok(await admin.get('/api/dashboard')).agedDeposits, undefined);
  ok(await admin.put('/api/setting', { values: { 'payment.depositAgeAlertDays': 60 } }));

  // customer: saldo hangus -> laporan penjualan (pendapatan lain, bukan penjualan)
  const customer = ok(await admin.post('/api/customer', { name: 'DP Hangus' }), 201);
  const cdep = ok(await admin.post('/api/customer-deposit', { customer: customer._id, method: 'CASH', amount: 40000 }), 201);
  assert.match((await admin.post(`/api/customer-deposit/${cdep._id}/write-off`, { reason: 'VENDOR_DISPUTE', note: 'x' })).message, /reason/);
  ok(await admin.post(`/api/customer-deposit/${cdep._id}/write-off`, { reason: 'FORFEITED', amount: 15000, note: 'DP pesanan batal, tidak diminta kembali' }));
  assert.equal(ok(await admin.get(`/api/customer-deposit/${cdep._id}`)).balance, 25000);
  assert.equal(ok(await admin.get(`/api/customer/${customer._id}`)).credit.deposit, 25000);
  const today = new Date().toLocaleDateString('en-CA');
  const rep = ok(await admin.get(`/api/sales-report/sales?from=${today}&to=${today}&customer=${customer._id}`)).totals;
  assert.deepEqual([rep.net, rep.depositForfeited], [0, 15000]);
});
