/**
 * Baris dokumen penjualan dengan kemasan jual (Quotation, Sales Order, Sales Invoice).
 * Field baris di form: key (stabil), uomId, uomCode, baseCode, konversi (isi), units (pilihan satuan dari backend:
 * [{ uom: { _id, code }, konversi, price, priceSource, isBase }]), qty = dalam satuan jual, hargaJual per satuan jual.
 * qty satuan dasar = qty x konversi (stok, HPP).
 */
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
let seq = 0;
export const newLineKey = () => `k${Date.now().toString(36)}${(seq++).toString(36)}`;

/** satuan jual untuk payload API: null = satuan dasar */
export const payloadUnit = (l) => ((l.konversi || 1) > 1 ? l.uomId : null);
/** kunci harga dari endpoint .../skus/prices (sama dengan backend unitKey) */
export const priceKey = (l) => `${l.sku._id}:${payloadUnit(l) || ''}`;
export const priceItems = (lines) => lines.map((l) => ({ sku: l.sku._id, uom: payloadUnit(l) }));
export const baseQty = (l) => round2((Number(l.qty) || 0) * (l.konversi || 1));

/** Field satuan dari baris dokumen (API) */
export const unitFieldsFromDoc = (l) => ({
  key: l._id || newLineKey(),
  uomId: l.uom?._id ?? l.uom ?? null,
  uomCode: l.uom?.code || l.produk?.uom?.code || '',
  baseCode: l.produk?.uom?.code || '',
  konversi: l.konversi || 1,
  units: l.units || [],
  qty: l.qtyUom ?? l.qty ?? '',
});

/** Field satuan dari hasil pencarian SKU (units + matchedUom dari backend) untuk 1 satuan */
export const unitFieldsFromSearch = (s, unit) => ({
  key: newLineKey(),
  uomId: unit?.uom?._id ?? null,
  uomCode: unit?.uom?.code || s.uom || '',
  baseCode: s.uom || '',
  konversi: unit?.konversi || 1,
  units: s.units || [],
  hargaJual: unit ? unit.price : (s.hargaJual ?? ''),
  priceSource: unit?.priceSource || s.priceSource || 'default',
});

/** Ganti satuan baris -> isi & harga mengikuti pilihan */
export const withUnit = (line, uomId) => {
  const u = (line.units || []).find((x) => String(x.uom?._id) === String(uomId));
  if (!u) return line;
  return { ...line, uomId: u.uom._id, uomCode: u.uom.code, konversi: u.konversi, hargaJual: u.price, priceSource: u.priceSource };
};

/** kunci satuan baris untuk mendeteksi duplikat SKU + satuan */
const unitKeyOf = (skuId, konversi, uomId) => `${skuId}:${konversi > 1 ? uomId : ''}`;

/**
 * Pilih satuan untuk SKU yang ditambahkan: kemasan hasil scan barcode (matchedUom) / satuan dasar, atau satuan
 * lain yang belum dipakai di dokumen (SKU sama boleh beberapa satuan). -> unit (dari s.units) atau null bila habis.
 */
export const nextUnitFor = (s, lines) => {
  const units = s.units?.length ? s.units : [{ uom: null, konversi: 1, price: s.hargaJual, priceSource: s.priceSource, isBase: true }];
  const used = new Set(lines.filter((l) => l.sku._id === s._id).map((l) => unitKeyOf(s._id, l.konversi || 1, l.uomId)));
  const free = units.filter((u) => !used.has(unitKeyOf(s._id, u.konversi, u.uom?._id)));
  if (!free.length) return null;
  return free.find((u) => s.matchedUom && String(u.uom?._id) === String(s.matchedUom)) || free.find((u) => u.isBase) || free[0];
};

/** Satuan yang boleh dipilih di baris (tidak bentrok dengan baris lain SKU yang sama) */
export const selectableUnits = (line, lines) => {
  const used = new Set(lines.filter((l) => l.key !== line.key && l.sku._id === line.sku._id).map((l) => unitKeyOf(l.sku._id, l.konversi || 1, l.uomId)));
  return (line.units || []).filter((u) => !used.has(unitKeyOf(line.sku._id, u.konversi, u.uom?._id)));
};

/** Teks qty: "10 DUS (240 PCS)" / "5 PCS" */
export const qtyText = (qty, line, fmt) => {
  const k = line.konversi || 1;
  return k > 1 ? `${fmt(qty)} ${line.uomCode} (${fmt(round2(qty * k))} ${line.baseCode})` : `${fmt(qty)} ${line.uomCode || line.baseCode}`;
};
