const { test } = require('node:test');
const assert = require('node:assert/strict');
const { useTestApp } = require('../helpers/setup');
const { ok, createMasters, createProduct, postAdjustment } = require('../helpers/factory');

const t = useTestApp();
const skuDoc = (id) => t.model('ProdukSku').findById(id).lean();

/** PO terbit: BOX isi 12 @120.000 -10% dan PCS @11.000 */
async function issuedPo(admin, m, sku, extra = {}) {
  return ok(await admin.post('/api/purchase-order', {
    vendor: m.vendor._id, gudang: m.gudang._id, issue: true,
    lines: [
      { sku: sku._id, uomBeli: m.box._id, konversi: 12, qty: 10, hargaBeli: 120000, diskonPersen: 10 },
      { sku: sku._id, uomBeli: m.pcs._id, konversi: 1, qty: 12, hargaBeli: 11000 },
    ],
    ...extra,
  }), 201);
}

test('settings: defaults, validation, audit', async () => {
  const admin = await t.loginAs();
  const s = ok(await admin.get('/api/setting'));
  assert.equal(s.values['tax.isPKP'], true);
  assert.equal(s.values['tax.ppnRate'], 11);
  assert.equal((await admin.put('/api/setting', { values: { 'tax.ppnRate': 150 } })).status, 400);
  assert.equal((await admin.put('/api/setting', { values: { 'tax.isPKP': 'yes' } })).status, 400);
  ok(await admin.put('/api/setting', { values: { 'tax.ppnRate': 12 } }));
  const log = await t.model('AuditLog').findOne({ entity: 'setting' }).lean();
  assert.equal(log.changes[0].from, 11);
  assert.equal(log.changes[0].to, 12);
  ok(await admin.put('/api/setting', { values: { 'tax.ppnRate': 11 } }));
  const viewer = await t.loginAs({ produk: [] });
  assert.equal((await viewer.put('/api/setting', { values: { 'tax.ppnRate': 5 } })).status, 403);
});

test('PO: totals, issue snapshot, only draft editable', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const sku = await createProduct(admin, m, 'PO Item');
  const draft = ok(await admin.post('/api/purchase-order', {
    vendor: m.vendor._id, gudang: m.gudang._id,
    lines: [{ sku: sku._id, uomBeli: m.box._id, konversi: 12, qty: 10, hargaBeli: 120000, diskonPersen: 10 }],
  }), 201);
  assert.equal(draft.status, 'DRAFT');
  assert.equal(draft.subtotal, 1080000);
  assert.equal(draft.taxAmount, 118800);
  assert.equal(draft.total, 1198800);
  const issued = ok(await admin.post(`/api/purchase-order/${draft._id}/issue`));
  assert.equal(issued.status, 'OPEN');
  assert.equal(issued.isPKP, true);
  const edit = await admin.put(`/api/purchase-order/${draft._id}`, { vendor: m.vendor._id, gudang: m.gudang._id, lines: [] });
  assert.equal(edit.status, 400);
  assert.match(edit.message, /Cancel this PO/);
});

test('GR: partial receipt, average cost, over-receipt rejected, cancel reverses cost', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const sku = await createProduct(admin, m, 'Avg Item');
  const po = await issuedPo(admin, m, sku);
  const [boxLine, pcsLine] = po.lines;

  const over = await admin.post('/api/goods-receipt', { purchaseOrder: po._id, lines: [{ poLine: boxLine._id, qty: 11 }] });
  assert.equal(over.status, 400);
  assert.match(over.message, /exceeds/);

  const gr1 = ok(await admin.post('/api/goods-receipt', { purchaseOrder: po._id, deliveryNoteNo: 'SJ-1', lines: [{ poLine: boxLine._id, qty: 4 }] }), 201);
  assert.equal(gr1.lines[0].qtyBase, 48);
  assert.equal(gr1.lines[0].unitCost, 9000);
  ok(await admin.post(`/api/goods-receipt/${gr1._id}/post`));
  let s = await skuDoc(sku._id);
  assert.equal(s.stok, 48);
  assert.equal(s.avgCost, 9000);
  assert.equal((await t.model('PurchaseOrder').findById(po._id).lean()).status, 'PARTIAL');

  const gr2 = ok(await admin.post('/api/goods-receipt', { purchaseOrder: po._id, lines: [{ poLine: pcsLine._id, qty: 12 }] }), 201);
  ok(await admin.post(`/api/goods-receipt/${gr2._id}/post`, { updateVendorPrice: true }));
  s = await skuDoc(sku._id);
  assert.equal(s.avgCost, 9400);
  const vp = await t.model('VendorPrice').findOne({ vendor: m.vendor._id, sku: sku._id, uomBeli: m.pcs._id }).lean();
  assert.equal(vp.hargaBeli, 11000);

  await postAdjustment(admin, m.gudang._id, [{ sku: sku._id, qtyChange: -10 }], 'DAMAGED');
  const mvAdj = await t.model('StockMovement').findOne({ sku: sku._id, type: 'ADJUSTMENT' }).lean();
  assert.equal(mvAdj.unitCost, 9400);
  assert.equal(mvAdj.value, -94000);

  ok(await admin.post(`/api/goods-receipt/${gr2._id}/cancel`, { reason: 'salah' }));
  s = await skuDoc(sku._id);
  assert.equal(s.stok, 38);
  assert.equal(s.avgCost, 8894.74);
});

test('PO close / cancel rules and closed PO cannot receive', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const sku = await createProduct(admin, m, 'Close Item');
  const po = await issuedPo(admin, m, sku);
  assert.equal((await admin.post(`/api/purchase-order/${po._id}/close`, { reason: 'x' })).status, 400); // belum ada penerimaan
  const gr = ok(await admin.post('/api/goods-receipt', { purchaseOrder: po._id, lines: [{ poLine: po.lines[0]._id, qty: 1 }] }), 201);
  ok(await admin.post(`/api/goods-receipt/${gr._id}/post`));
  const draftGr = ok(await admin.post('/api/goods-receipt', { purchaseOrder: po._id, lines: [{ poLine: po.lines[0]._id, qty: 1 }] }), 201);
  const blocked = await admin.post(`/api/purchase-order/${po._id}/close`, { reason: 'sisa' });
  assert.equal(blocked.status, 400);
  assert.match(blocked.message, /draft goods receipt/);
  ok(await admin.del(`/api/goods-receipt/${draftGr._id}`));
  assert.equal((await admin.post(`/api/purchase-order/${po._id}/cancel`, { reason: 'x' })).status, 400); // sudah PARTIAL
  ok(await admin.post(`/api/purchase-order/${po._id}/close`, { reason: 'sisa tidak dikirim' }));
  assert.equal((await admin.post('/api/goods-receipt', { purchaseOrder: po._id, lines: [{ poLine: po.lines[0]._id, qty: 1 }] })).status, 400);

  const po2 = await issuedPo(admin, m, sku);
  ok(await admin.post(`/api/purchase-order/${po2._id}/cancel`, { reason: 'batal' }));
});

test('non-PKP: PPN becomes part of cost; existing PO keeps its snapshot', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const sku = await createProduct(admin, m, 'NonPKP');
  ok(await admin.put('/api/setting', { values: { 'tax.isPKP': false } }));
  const po = ok(await admin.post('/api/purchase-order', {
    vendor: m.vendor._id, gudang: m.gudang._id, issue: true,
    lines: [{ sku: sku._id, uomBeli: m.pcs._id, konversi: 1, qty: 2, hargaBeli: 10000 }],
  }), 201);
  ok(await admin.put('/api/setting', { values: { 'tax.isPKP': true } }));
  const gr = ok(await admin.post('/api/goods-receipt', { purchaseOrder: po._id, lines: [{ poLine: po.lines[0]._id, qty: 2 }] }), 201);
  assert.equal(gr.lines[0].unitCost, 11100);
});

test('cost data hidden without vendorPrice:view; vendor price option needs permission', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const sku = await createProduct(admin, m, 'Hidden Cost');
  const po = await issuedPo(admin, m, sku);
  const wh = await t.loginAs({ goodsReceipt: ['create', 'update', 'post'], stockMovement: [] });
  const gr = ok(await wh.post('/api/goods-receipt', { purchaseOrder: po._id, lines: [{ poLine: po.lines[0]._id, qty: 1 }] }), 201);
  assert.equal((await wh.post(`/api/goods-receipt/${gr._id}/post`, { updateVendorPrice: true })).status, 403);
  ok(await wh.post(`/api/goods-receipt/${gr._id}/post`));

  const mv = ok(await wh.get('/api/stock-movement', { sku: sku._id }));
  assert.equal(mv.canSeeCost, false);
  assert.ok(mv.dataMovement.every((x) => x.unitCost === undefined && x.value === undefined));
  const fromPo = ok(await wh.get(`/api/goods-receipt/from-po/${po._id}`));
  assert.equal(fromPo.lines[0].hargaBeli, undefined);
  assert.equal((await wh.get('/api/stock-valuation')).status, 403);
});

test('master used by PO cannot be deleted; inactive SKU cannot be ordered', async () => {
  const admin = await t.loginAs();
  const m = await createMasters(admin);
  const sku = await createProduct(admin, m, 'Integrity');
  await issuedPo(admin, m, sku);
  assert.equal((await admin.del(`/api/vendor/${m.vendor._id}`)).status, 400);
  assert.equal((await admin.del(`/api/uom/${m.box._id}`)).status, 400);
  assert.equal((await admin.del(`/api/produk/${sku.produk._id}/sku/${sku._id}`)).status, 400);
  ok(await admin.put(`/api/produk/${sku.produk._id}/sku`, { skus: [{ _id: sku._id, sku: sku.sku, hargaJual: 0, isActive: false }] }));
  const res = await admin.post('/api/purchase-order', { vendor: m.vendor._id, gudang: m.gudang._id, lines: [{ sku: sku._id, uomBeli: m.pcs._id, konversi: 1, qty: 1, hargaBeli: 1 }] });
  assert.equal(res.status, 400);
  assert.match(res.message, /inactive/);
});
