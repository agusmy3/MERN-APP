const { test } = require('node:test');
const assert = require('node:assert/strict');
const { useTestApp } = require('../helpers/setup');
const { ok, createMasters, createProduct, postAdjustment } = require('../helpers/factory');

const t = useTestApp();
const balanceOf = async (sku, gudang) => (await t.model('StockBalance').findOne({ sku, gudang }).lean())?.qty ?? 0;

/** SKU 11.100 (HPP 6.000, stok 20) + 2 outlet (gudang sama) + kasir A (outlet 1) + supervisor ber-PIN (outlet 1) */
async function setup(admin) {
  const m = await createMasters(admin);
  const sku = await createProduct(admin, m, `POS2 ${Date.now()}`);
  ok(await admin.put(`/api/produk/${sku.produk._id}/sku`, { skus: [{ _id: sku._id, sku: sku.sku, hargaJual: 11100, isActive: true }] }));
  await postAdjustment(admin, m.gudang._id, [{ sku: sku._id, qtyChange: 20, unitCost: 6000 }], 'OPENING');
  const mk = (code) => admin.post('/api/outlet', { code: `${code}${Date.now() % 100000}`, name: code, gudang: m.gudang._id });
  const outlet = ok(await mk('A'), 201);
  const outlet2 = ok(await mk('B'), 201);
  await require('../../controllers/customerController').ensureWalkInCustomer();
  const cashier = await t.loginAs({ pos: ['create'] }, 'Kasir', { outlets: [outlet._id] });
  const cashier2 = await t.loginAs({ pos: ['create'] }, 'Kasir B', { outlets: [outlet2._id] });
  const spvUser = await t.loginAs({ pos: ['create', 'post'] }, 'Supervisor', { outlets: [outlet._id] });
  const spvDoc = await t.model('User').findOne({ name: 'Supervisor' }).sort({ createdDate: -1 }).lean();
  ok(await admin.put(`/api/user/${spvDoc._id}`, { posPin: '1234' }));
  ok(await cashier.post('/api/pos/shift/open', { outlet: outlet._id, openingCash: 100000 }), 201);
  return { m, sku, outlet, outlet2, cashier, cashier2, spv: { _id: spvDoc._id, client: spvUser } };
}

const sell = (cashier, sku, qty, payments) => cashier.post('/api/pos/sales', { lines: [{ sku: sku._id, qty }], payments });

test('supervisor PIN: hashed, never returned, validated', async () => {
  const admin = await t.loginAs();
  const s = await setup(admin);
  const raw = await t.model('User').findById(s.spv._id).select('+posPinHash').lean();
  assert.ok(raw.posPinHash && raw.posPinHash !== '1234');
  const u = ok(await admin.get(`/api/user/${s.spv._id}`));
  assert.equal(u.posPinHash, undefined);
  assert.equal(u.hasPosPin, true);
  assert.equal((await admin.put(`/api/user/${s.spv._id}`, { posPin: '12a' })).status, 400);
  const approvers = ok(await s.cashier.get('/api/pos/approvers'));
  assert.deepEqual(approvers.map((a) => a._id), [String(s.spv._id)]);
});

test('hold: park, list, resume (latest price & stock), discard, max, cleared on close', async () => {
  const admin = await t.loginAs();
  const s = await setup(admin);
  const h = ok(await s.cashier.post('/api/pos/holds', { lines: [{ sku: s.sku._id, qty: 2, diskonPersen: 5 }], note: 'Ibu baju merah' }), 201);
  assert.equal(await balanceOf(s.sku._id, s.m.gudang._id), 20); // stok tidak dikunci
  const list = ok(await s.cashier.get('/api/pos/holds'));
  assert.equal(list.length, 1);
  assert.equal(list[0].note, 'Ibu baju merah');
  const resumed = ok(await s.cashier.post(`/api/pos/holds/${h._id}/resume`));
  assert.equal(resumed.lines[0].qty, 2);
  assert.equal(resumed.lines[0].hargaJual, 11100);
  assert.equal(resumed.lines[0].stock, 20);
  assert.equal(ok(await s.cashier.get('/api/pos/holds')).length, 0); // dihapus setelah dilanjutkan

  const h2 = ok(await s.cashier.post('/api/pos/holds', { lines: [{ sku: s.sku._id, qty: 1 }] }), 201);
  assert.equal((await s.cashier2.del(`/api/pos/holds/${h2._id}`)).status, 400); // kasir lain (belum buka shift)
  ok(await s.cashier.del(`/api/pos/holds/${h2._id}`));
  for (let i = 0; i < 10; i++) ok(await s.cashier.post('/api/pos/holds', { lines: [{ sku: s.sku._id, qty: 1 }] }), 201);
  assert.equal((await s.cashier.post('/api/pos/holds', { lines: [{ sku: s.sku._id, qty: 1 }] })).status, 400);
  assert.equal(ok(await s.cashier.get('/api/pos/context')).shift.holdCount, 10);
  ok(await s.cashier.post('/api/pos/shift/close', { closingCash: 100000 }));
  assert.equal(await t.model('PosHold').countDocuments({ cashier: (await t.model('PosShift').findOne().sort({ _id: -1 })).cashier }), 0);
});

test('void: needs supervisor PIN, reverses stock & cash, only current shift, PIN lockout', async () => {
  const admin = await t.loginAs();
  const s = await setup(admin);
  const sale = ok(await sell(s.cashier, s.sku, 2, [{ method: 'CASH', amount: 30000 }]), 201); // 22.200, kembali 7.800
  assert.equal(await balanceOf(s.sku._id, s.m.gudang._id), 18);
  let ctx = ok(await s.cashier.get('/api/pos/context'));
  assert.equal(ctx.shift.summary.expectedCash, 122200);

  const look = ok(await s.cashier.get(`/api/pos/sales/lookup?no=${sale.no}`));
  assert.equal(look.canVoid, true);
  const voidIt = (pin, extra = {}) => s.cashier.post(`/api/pos/sales/${sale._id}/void`, { reason: 'Salah scan', approver: s.spv._id, pin, ...extra });
  assert.equal((await voidIt('1234', { reason: '' })).status, 400);
  assert.equal((await voidIt('0000')).status, 403);
  // kasir sendiri tanpa pos:post tidak bisa jadi penyetuju
  const cashierDoc = await t.model('User').findOne({ name: 'Kasir' }).sort({ createdDate: -1 }).lean();
  assert.equal((await s.cashier.post(`/api/pos/sales/${sale._id}/void`, { reason: 'x', approver: cashierDoc._id, pin: '1234' })).status, 403);

  const voided = ok(await voidIt('1234'));
  assert.equal(voided.no, sale.no);
  assert.equal(await balanceOf(s.sku._id, s.m.gudang._id), 20);
  const inv = await t.model('SalesInvoice').findById(sale._id).lean();
  assert.equal(inv.status, 'CANCELLED');
  assert.equal(String(inv.voidApprovedBy), String(s.spv._id));
  assert.match(inv.cancelReason, /VOID: Salah scan/);
  ctx = ok(await s.cashier.get('/api/pos/context'));
  assert.equal(ctx.shift.summary.expectedCash, 100000);
  assert.equal(ctx.shift.summary.voidCount, 1);
  assert.equal((await voidIt('1234')).status, 400); // sudah dibatalkan

  // 5x PIN salah -> terkunci (PIN benar pun ditolak)
  const sale2 = ok(await sell(s.cashier, s.sku, 1, [{ method: 'CASH', amount: 11100 }]), 201);
  const v2 = (pin) => s.cashier.post(`/api/pos/sales/${sale2._id}/void`, { reason: 'x', approver: s.spv._id, pin });
  for (let i = 0; i < 5; i++) assert.equal((await v2('9999')).status, 403);
  assert.equal((await v2('1234')).status, 429);
  await t.model('User').updateOne({ _id: s.spv._id }, { posPinLockedUntil: null }); // buka kunci untuk test berikutnya

  // transaksi dari shift sebelumnya tidak bisa di-void -> retur
  ok(await s.cashier.post('/api/pos/shift/close', { closingCash: 111100 }));
  ok(await s.cashier.post('/api/pos/shift/open', { outlet: s.outlet._id, openingCash: 50000 }), 201);
  const old = ok(await s.cashier.get(`/api/pos/sales/lookup?no=${sale2.no}`));
  assert.equal(old.canVoid, false);
  assert.equal(old.canReturn, true);
  assert.equal((await v2('1234')).status, 400);
});

test('return at register: same outlet only, refund from drawer, report per cashier', async () => {
  const admin = await t.loginAs();
  const s = await setup(admin);
  const sale = ok(await sell(s.cashier, s.sku, 3, [{ method: 'CASH', amount: 33300 }]), 201);
  // shift berikutnya (transaksi lama tetap bisa diretur di outlet yang sama)
  ok(await s.cashier.post('/api/pos/shift/close', { closingCash: 133300 }));
  ok(await s.cashier.post('/api/pos/shift/open', { outlet: s.outlet._id, openingCash: 20000 }), 201);

  // outlet lain ditolak
  ok(await s.cashier2.post('/api/pos/shift/open', { outlet: s.outlet2._id, openingCash: 0 }), 201);
  assert.equal((await s.cashier2.get(`/api/pos/sales/lookup?no=${sale.no}`)).status, 400);

  const ret = (body) => s.cashier.post('/api/pos/returns', {
    salesInvoice: sale._id, reason: 'Rusak', approver: s.spv._id, pin: '1234', refundMethod: 'CASH', ...body,
  });
  assert.equal((await ret({ lines: [{ sku: s.sku._id, qty: 4 }] })).status, 400);  // > terjual
  assert.equal((await ret({ lines: [{ sku: s.sku._id, qty: 1 }], pin: '1111' })).status, 403);
  assert.equal((await ret({ lines: [{ sku: s.sku._id, qty: 3 }] })).status, 400);  // refund 33.300 > laci 20.000
  const r = ok(await ret({ lines: [{ sku: s.sku._id, qty: 1 }] }), 201);
  assert.match(r.returnNo, /^RTN-/);
  assert.equal(r.refund.amount, 11100);
  assert.equal(r.refund.method, 'CASH');
  assert.equal(await balanceOf(s.sku._id, s.m.gudang._id), 18);
  const inv = await t.model('SalesInvoice').findById(sale._id).lean();
  assert.equal(inv.returnedAmount, 11100);
  assert.equal(inv.paymentStatus, 'PAID');
  const ctx = ok(await s.cashier.get('/api/pos/context'));
  assert.equal(ctx.shift.summary.expectedCash, 20000 - 11100);
  assert.equal(ctx.shift.summary.returnCount, 1);

  // refund non-tunai (QRIS) tidak memotong laci
  const r2 = ok(await ret({ lines: [{ sku: s.sku._id, qty: 1 }], refundMethod: 'QRIS', reference: 'QR-REF' }), 201);
  assert.equal(r2.refund.method, 'QRIS');
  assert.equal(ok(await s.cashier.get('/api/pos/context')).shift.summary.expectedCash, 8900);

  // laporan per kasir
  const report = ok(await admin.get('/api/pos-shift/report'));
  const row = report.rows.find((x) => x.cashier.name === 'Kasir');
  assert.equal(row.salesCount, 1);
  assert.equal(row.salesTotal, 33300);
  assert.equal(row.returnCount, 2);
  assert.equal(row.returnTotal, 22200);
  assert.equal(row.byMethod.CASH, 33300 - 11100);
  assert.equal(row.byMethod.QRIS, -11100);
  assert.equal(row.shifts, 2);
  assert.equal(row.openShifts, 1);
  assert.equal((await s.cashier.get('/api/pos-shift/report')).status, 403);
});
