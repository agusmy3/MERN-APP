const { test } = require('node:test');
const assert = require('node:assert/strict');
const { useTestApp } = require('../helpers/setup');
const { ok, createMasters, createProduct, postAdjustment } = require('../helpers/factory');

const t = useTestApp();
const skuDoc = (id) => t.model('ProdukSku').findById(id).lean();
const balance = async (sku, gudang) => (await t.model('StockBalance').findOne({ sku, gudang }).lean())?.qty ?? 0;

/** Master + gudang kedua + 1 SKU berstok 10 @ HPP 1.000 di gudang pertama */
async function setup(admin, name) {
  const m = await createMasters(admin);
  m.gudang2 = ok(await admin.post('/api/gudang', { code: `${m.gudang.code}B`, name: `${m.gudang.name} B` }), 201);
  const sku = await createProduct(admin, m, name);
  await postAdjustment(admin, m.gudang._id, [{ sku: sku._id, qtyChange: 10, unitCost: 1000 }], 'OPENING');
  return { m, sku };
}

const draft = (client, m, lines, extra = {}) => client.post('/api/stock-transfer', {
  fromGudang: m.gudang._id, toGudang: m.gudang2._id, lines, ...extra,
});

test('send -> in transit -> receive: stock moves, HPP preserved, value travels with it', async () => {
  const admin = await t.loginAs();
  const { m, sku } = await setup(admin, 'Transfer A');

  const doc = ok(await draft(admin, m, [{ sku: sku._id, qty: 4 }]), 201);
  assert.match(doc.no, /^TRF-\d{6}-\d{4}$/);
  assert.equal(await balance(sku._id, m.gudang._id), 10); // draft tidak mengubah stok

  ok(await admin.post(`/api/stock-transfer/${doc._id}/send`));
  assert.equal(await balance(sku._id, m.gudang._id), 6);
  assert.equal(await balance(sku._id, m.gudang2._id), 0);
  assert.equal((await skuDoc(sku._id)).stok, 6); // dalam perjalanan: tidak di gudang mana pun
  const sent = ok(await admin.get(`/api/stock-transfer/${doc._id}`));
  assert.equal(sent.status, 'IN_TRANSIT');
  assert.equal(sent.lines[0].unitCost, 1000);
  assert.equal(sent.totalValue, 4000);

  // valuasi menampilkan nilai dalam perjalanan terpisah
  const val = ok(await admin.get('/api/stock-valuation'));
  assert.equal(val.totals.inTransit.value, 4000);

  // draft / terkirim tidak bisa diubah lagi
  assert.equal((await admin.put(`/api/stock-transfer/${doc._id}`, { fromGudang: m.gudang._id, toGudang: m.gudang2._id, lines: [{ sku: sku._id, qty: 1 }] })).status, 400);
  assert.equal((await admin.del(`/api/stock-transfer/${doc._id}`)).status, 400);

  ok(await admin.post(`/api/stock-transfer/${doc._id}/receive`, {}));
  assert.equal(await balance(sku._id, m.gudang2._id), 4);
  assert.equal((await skuDoc(sku._id)).stok, 10);
  assert.equal((await skuDoc(sku._id)).avgCost, 1000);

  const mv = await t.model('StockMovement').find({ refId: doc._id }).sort({ _id: 1 }).lean();
  assert.deepEqual(mv.map((x) => [x.type, x.qty, x.value]), [['TRANSFER_OUT', -4, -4000], ['TRANSFER_IN', 4, 4000]]);
  assert.equal(ok(await admin.get('/api/stock-valuation')).totals.inTransit.value, 0);

  // setelah diterima tidak bisa dibatalkan (buat transfer balik)
  assert.equal((await admin.post(`/api/stock-transfer/${doc._id}/cancel`, { reason: 'x' })).status, 400);
  const hist = ok(await admin.get('/api/audit-log/history', { entity: 'stockTransfer', id: doc._id }));
  assert.ok(hist.logs.length >= 3);
});

test('receive: short needs a note (difference = loss), over is rejected', async () => {
  const admin = await t.loginAs();
  const { m, sku } = await setup(admin, 'Transfer B');
  const doc = ok(await draft(admin, m, [{ sku: sku._id, qty: 5 }]), 201);
  ok(await admin.post(`/api/stock-transfer/${doc._id}/send`));

  assert.equal((await admin.post(`/api/stock-transfer/${doc._id}/receive`, { lines: [{ sku: sku._id, qtyReceived: 6 }] })).status, 400);
  assert.equal((await admin.post(`/api/stock-transfer/${doc._id}/receive`, { lines: [{ sku: sku._id, qtyReceived: 3 }] })).status, 400);
  ok(await admin.post(`/api/stock-transfer/${doc._id}/receive`, { lines: [{ sku: sku._id, qtyReceived: 3 }], note: '2 pcs rusak di jalan' }));

  assert.equal(await balance(sku._id, m.gudang2._id), 3);
  assert.equal((await skuDoc(sku._id)).stok, 8);
  const got = ok(await admin.get(`/api/stock-transfer/${doc._id}`));
  assert.equal(got.lines[0].qtyReceived, 3);
  assert.equal(got.totalLoss, 2000);
  assert.equal(got.receiveNote, '2 pcs rusak di jalan');
});

test('cancel while in transit returns stock; insufficient stock cannot be sent; validation', async () => {
  const admin = await t.loginAs();
  const { m, sku } = await setup(admin, 'Transfer C');

  const tooMuch = ok(await draft(admin, m, [{ sku: sku._id, qty: 11 }]), 201);
  assert.equal((await admin.post(`/api/stock-transfer/${tooMuch._id}/send`)).status, 400);
  ok(await admin.del(`/api/stock-transfer/${tooMuch._id}`));

  for (const body of [
    { fromGudang: m.gudang._id, toGudang: m.gudang._id, lines: [{ sku: sku._id, qty: 1 }] }, // gudang sama
    { fromGudang: m.gudang._id, toGudang: m.gudang2._id, lines: [{ sku: sku._id, qty: 0 }] },
    { fromGudang: m.gudang._id, toGudang: m.gudang2._id, lines: [{ sku: sku._id, qty: 1.555 }] },
    { fromGudang: m.gudang._id, toGudang: m.gudang2._id, lines: [] },
  ]) assert.equal((await admin.post('/api/stock-transfer', body)).status, 400);

  const doc = ok(await draft(admin, m, [{ sku: sku._id, qty: 7 }]), 201);
  ok(await admin.post(`/api/stock-transfer/${doc._id}/send`));
  assert.equal((await admin.post(`/api/stock-transfer/${doc._id}/cancel`, {})).status, 400); // alasan wajib
  ok(await admin.post(`/api/stock-transfer/${doc._id}/cancel`, { reason: 'Salah gudang' }));
  assert.equal(await balance(sku._id, m.gudang._id), 10);
  assert.equal((await skuDoc(sku._id)).avgCost, 1000);
  assert.equal((await admin.post(`/api/stock-transfer/${doc._id}/receive`, {})).status, 400);

  // gudang dengan histori transfer tidak bisa dihapus
  assert.equal((await admin.del(`/api/gudang/${m.gudang2._id}`)).status, 400);
});

test('reorder counts stock in transit to the destination as on order', async () => {
  const admin = await t.loginAs();
  const { m, sku } = await setup(admin, 'Transfer D');
  ok(await admin.put('/api/reorder/rules', { rules: [{ sku: sku._id, gudang: m.gudang2._id, minQty: 5, maxQty: 20 }] }));
  let alerts = ok(await admin.get('/api/reorder', { status: 'ALL' }));
  assert.equal(alerts.find((r) => String(r.gudang._id) === String(m.gudang2._id)).status, 'OUT');

  const doc = ok(await draft(admin, m, [{ sku: sku._id, qty: 8 }]), 201);
  ok(await admin.post(`/api/stock-transfer/${doc._id}/send`));
  alerts = ok(await admin.get('/api/reorder', { status: 'ALL' }));
  const row = alerts.find((r) => String(r.gudang._id) === String(m.gudang2._id));
  assert.equal(row.onOrder, 8);
  assert.equal(row.status, 'ORDERED');
});

test('warehouse access: sender needs the source, receiver needs the destination', async () => {
  const admin = await t.loginAs();
  const { m, sku } = await setup(admin, 'Transfer E');
  const perms = { stockTransfer: ['create', 'update', 'delete', 'post'] };
  const sender = await t.loginAs(perms, 'Sender', { gudangs: [m.gudang._id] });
  const receiver = await t.loginAs(perms, 'Receiver', { gudangs: [m.gudang2._id] });
  const outsider = await t.loginAs(perms, 'Outsider', { gudangs: [] });

  // penerima tidak boleh membuat transfer dari gudang yang bukan miliknya
  assert.equal((await draft(receiver, m, [{ sku: sku._id, qty: 1 }])).status, 403);
  const doc = ok(await draft(sender, m, [{ sku: sku._id, qty: 2 }]), 201);
  assert.equal((await receiver.post(`/api/stock-transfer/${doc._id}/send`)).status, 403);
  const sendable = ok(await sender.get(`/api/stock-transfer/${doc._id}`));
  assert.equal(sendable.canSend, true);
  assert.equal(sendable.canReceive, false);
  assert.equal(sendable.lines[0].unitCost, undefined); // tanpa vendorPrice:view
  ok(await sender.post(`/api/stock-transfer/${doc._id}/send`));

  assert.equal((await sender.post(`/api/stock-transfer/${doc._id}/receive`, {})).status, 403);
  assert.equal((await outsider.get(`/api/stock-transfer/${doc._id}`)).status, 403);
  assert.equal(ok(await outsider.get('/api/stock-transfer')).totalData, 0);
  assert.equal(ok(await receiver.get('/api/stock-transfer')).totalData, 1); // transfer ke gudangnya terlihat
  ok(await receiver.post(`/api/stock-transfer/${doc._id}/receive`, {}));
  assert.equal(await balance(sku._id, m.gudang2._id), 2);
});
