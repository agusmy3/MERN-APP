/**
 * Data master lewat API (supaya validasi & audit ikut berjalan seperti aslinya).
 *   const m = await createMasters(admin);       // kategori, PCS, BOX, vendor, gudang MAIN
 *   const sku = await createProduct(admin, m, 'Kaos');   // produk tanpa varian -> 1 SKU default
 */
const assert = require('node:assert/strict');

const ok = (res, status = 200) => {
  assert.equal(res.status, status, `${res.status} ${res.message}`);
  return res.data;
};

let codeSeq = 0;

async function createMasters(admin) {
  codeSeq += 1;
  const kategori = ok(await admin.post('/api/kategori', { name: `Kategori ${codeSeq}` }), 201);
  const pcs = ok(await admin.post('/api/uom', { code: `PCS${codeSeq}`, name: 'Pieces' }), 201);
  const box = ok(await admin.post('/api/uom', { code: `BOX${codeSeq}`, name: 'Box' }), 201);
  const vendor = ok(await admin.post('/api/vendor', { companyName: `Vendor ${codeSeq}`, picName: 'PIC', picContact: '0800', companyAddress: 'Jl. Test' }), 201);
  const gudang = ok(await admin.post('/api/gudang', { code: `WH${codeSeq}`, name: `Warehouse ${codeSeq}` }), 201);
  return { kategori, pcs, box, vendor, gudang };
}

async function createProduct(admin, m, name) {
  const produk = ok(await admin.post('/api/produk', { name, kategori: m.kategori._id, uom: m.pcs._id, variants: [] }), 201);
  const { skus } = ok(await admin.get(`/api/produk/${produk._id}/sku`));
  return { ...skus[0], produk };
}

/** Buat & posting adjustment. lines: [{ sku, qtyChange, unitCost? }] */
async function postAdjustment(admin, gudang, lines, reason = 'CORRECTION') {
  const doc = ok(await admin.post('/api/stock-adjustment', { type: 'ADJUSTMENT', gudang, reason, lines }), 201);
  ok(await admin.post(`/api/stock-adjustment/${doc._id}/post`));
  return doc;
}

module.exports = { ok, createMasters, createProduct, postAdjustment };
