const { test } = require('node:test');
const assert = require('node:assert/strict');
const { useTestApp } = require('../helpers/setup');
const { ok, createMasters, createProduct } = require('../helpers/factory');

const t = useTestApp();
const ADDRESS = { address: 'Jl. Mawar 1', provinsi: 'DKI Jakarta', kota: 'Jakarta Pusat', kecamatan: 'Menteng', kodePos: '10310' };
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

async function setup(admin) {
  const m = await createMasters(admin);
  const a = await createProduct(admin, m, `QUO A ${Date.now()}`);
  await t.model('ProdukSku').updateOne({ _id: a._id }, { hargaJual: 100000 });
  const customer = ok(await admin.post('/api/customer', { name: 'PT Prospek', ...ADDRESS }), 201);
  const { ensureWalkInCustomer } = require('../../controllers/customerController');
  const { customer: walkIn } = await ensureWalkInCustomer();
  return { m, a, customer, walkIn };
}

const body = (s, extra = {}) => ({
  customer: s.customer._id,
  gudang: s.m.gudang._id,
  lines: [{ sku: s.a._id, qty: 5, hargaJual: 1, diskonPersen: 10 }],
  discountAmount: 5000,
  shippingCharge: 15000,
  ...extra,
});

test('quotation: frozen prices, default validity, send locks prices, convert to sales order with quoted prices', async () => {
  const admin = await t.loginAs();
  const s = await setup(admin);

  const q = ok(await admin.post('/api/quotation', body(s, { date: day(0) })), 201);
  assert.match(q.no, /^QUO-\d{6}-\d{4}$/);
  assert.equal(q.status, 'DRAFT');
  assert.equal(q.lines[0].hargaJual, 100000);               // input klien diabaikan
  assert.equal(q.subtotal, 450000);
  assert.equal(Math.round((new Date(q.validUntil) - new Date(new Date(q.date).setHours(0, 0, 0, 0))) / 86400000), 14);
  assert.equal(await t.model('StockBalance').countDocuments({ sku: s.a._id }), 0); // tidak mengubah stok

  ok(await admin.post(`/api/quotation/${q._id}/send`));
  assert.equal((await admin.put(`/api/quotation/${q._id}`, body(s))).status, 400); // terkunci setelah dikirim
  await t.model('ProdukSku').updateOne({ _id: s.a._id }, { hargaJual: 120000 }); // harga naik setelah penawaran

  const res = ok(await admin.post(`/api/quotation/${q._id}/convert`, {}), 201);
  const so = res.salesOrder;
  assert.equal(so.status, 'DRAFT');
  assert.equal(so.lines[0].hargaJual, 100000);               // harga penawaran
  assert.equal(so.lines[0].diskonPersen, 10);
  assert.equal(so.discountAmount, 5000);
  assert.equal(so.shippingCharge, 15000);
  assert.equal(so.shipTo.alamat, 'Jl. Mawar 1');
  assert.equal(String(so.quotation), String(q._id));
  const after = ok(await admin.get(`/api/quotation/${q._id}`));
  assert.equal(after.status, 'ACCEPTED');
  assert.equal(after.salesOrder.no, so.no);
  assert.match((await admin.post(`/api/quotation/${q._id}/convert`, {})).message, /accepted/);

  // SO dari quotation tetap memakai harga penawaran saat draft diubah
  const upd = ok(await admin.put(`/api/sales-order/${so._id}`, {
    customer: s.customer._id, gudang: s.m.gudang._id, lines: [{ sku: s.a._id, qty: 6, diskonPersen: 10 }], discountAmount: 5000, shippingCharge: 15000,
  }));
  assert.equal(upd.lines[0].hargaJual, 100000);
  assert.equal(upd.lines[0].qty, 6);

  const log = await t.model('AuditLog').find({ entity: 'quotation', entityId: q._id }).lean();
  assert.ok(log.length >= 3);
});

test('quotation: walk-in prospect, expiry, revise, reject, permissions', async () => {
  const admin = await t.loginAs();
  const s = await setup(admin);

  // walk-in: nama calon pembeli wajib; konversi butuh customer bernama
  assert.match((await admin.post('/api/quotation', body(s, { customer: s.walkIn._id }))).message, /prospect name/);
  const w = ok(await admin.post('/api/quotation', body(s, { customer: s.walkIn._id, prospectName: 'Budi', prospectContact: '0812', send: true })), 201);
  assert.equal(w.status, 'SENT');
  assert.match((await admin.post(`/api/quotation/${w._id}/convert`, {})).message, /named customer/);
  assert.match((await admin.post(`/api/quotation/${w._id}/convert`, { customer: s.walkIn._id })).message, /walk-in/); // ditolak SO
  ok(await admin.post(`/api/quotation/${w._id}/convert`, { customer: s.customer._id }), 201);

  // kedaluwarsa: tidak bisa dikonversi; revise -> draft -> perpanjang -> kirim lagi
  const e = ok(await admin.post('/api/quotation', body(s, { date: day(-20), validUntil: day(-5), deliveryMethod: 'PICKUP' })), 201);
  assert.equal(e.shippingCharge, 0); // diambil sendiri: tanpa ongkir
  assert.match((await admin.post(`/api/quotation/${e._id}/send`)).message, /Valid-until/);
  await t.model('Quotation').updateOne({ _id: e._id }, { status: 'SENT', sentDate: new Date() });
  assert.equal(ok(await admin.get(`/api/quotation/${e._id}`)).expired, true);
  assert.ok(ok(await admin.get('/api/quotation?status=EXPIRED')).dataQuotation.some((x) => x._id === String(e._id)));
  assert.match((await admin.post(`/api/quotation/${e._id}/convert`, {})).message, /expired/);
  ok(await admin.post(`/api/quotation/${e._id}/revise`));
  ok(await admin.put(`/api/quotation/${e._id}`, body(s, { date: day(0), validUntil: day(7) })));
  ok(await admin.post(`/api/quotation/${e._id}/send`));
  assert.equal((await admin.post(`/api/quotation/${e._id}/reject`, {})).status, 400); // alasan wajib
  const rej = ok(await admin.post(`/api/quotation/${e._id}/reject`, { reason: 'Harga kompetitor lebih murah' }));
  assert.equal(rej.status, 'REJECTED');
  assert.equal((await admin.del(`/api/quotation/${e._id}`)).status, 400); // hanya draft

  // izin: konversi butuh salesOrder:create
  const q = ok(await admin.post('/api/quotation', body(s, { send: true })), 201);
  const quoOnly = await t.loginAs({ quotation: ['view', 'create', 'update'] }, 'QuoOnly');
  assert.equal((await quoOnly.post(`/api/quotation/${q._id}/convert`, {})).status, 403);
  const viewer = await t.loginAs({ quotation: ['view'] }, 'QuoView');
  assert.equal((await viewer.post('/api/quotation', body(s))).status, 403);
  assert.equal((await viewer.get(`/api/quotation/${q._id}`)).status, 200);
  assert.equal((await viewer.get('/api/sales-order')).status, 403);

  // customer yang punya quotation tidak bisa dihapus
  const c2 = ok(await admin.post('/api/customer', { name: 'Hapus', ...ADDRESS }), 201);
  ok(await admin.post('/api/quotation', body(s, { customer: c2._id })), 201);
  assert.match((await admin.del(`/api/customer/${c2._id}`)).message, /quotation/);
});
