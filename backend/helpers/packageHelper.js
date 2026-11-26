const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const PriceList = require('../models/PriceList');
const ProdukSku = require('../models/ProdukSku');
const { HttpError } = require('./transaction');
const { round2 } = require('./number');

/**
 * Kemasan jual & harga per kemasan (dokumen penjualan back-office).
 * Baris dokumen: `uom` (satuan jual), `konversi` (isi), `qtyUom` (qty dalam satuan jual; null = data lama = qty),
 * `qty` = qtyUom x konversi (SATUAN DASAR: stok, HPP, dipesan, laporan), `hargaJual` per satuan jual.
 */
const unitKey = (sku, uom) => `${sku}:${uom ? String(uom) : ''}`;
const qtyUomOf = (l) => (l.qtyUom === null || l.qtyUom === undefined ? l.qty : l.qtyUom);
const konversiOf = (l) => l.konversi || 1;

/**
 * SKU -> { sku, produk, isActive, baseUom: { _id, code }, hargaJual, packages: [{ _id, uom: { _id, code }, konversi, hargaJual, barcode, isActive }] }
 */
const loadUnits = async (skuIds) => {
  const ids = [...new Set(skuIds.filter((id) => mongoose.isValidObjectId(id)).map(String))];
  const skus = await ProdukSku.find({ _id: { $in: ids } }).select('sku produk hargaJual isActive packages')
    .populate({ path: 'produk', select: 'uom', populate: { path: 'uom', select: 'code' } })
    .populate('packages.uom', 'code')
    .lean();
  return new Map(skus.map((s) => [String(s._id), {
    sku: s.sku,
    produk: s.produk?._id,
    isActive: s.isActive,
    baseUom: s.produk?.uom || null,
    hargaJual: s.hargaJual ?? 0,
    packages: s.packages || [],
  }]));
};

/** Satuan jual: satuan dasar (uom kosong / = satuan dasar) atau kemasan SKU -> { uom, code, konversi, pkg } */
const unitOf = (unitInfo, uom, { allowInactive = false } = {}) => {
  if (!uom || String(uom) === String(unitInfo.baseUom?._id)) {
    return { uom: unitInfo.baseUom?._id ?? null, code: unitInfo.baseUom?.code || '', konversi: 1, pkg: null };
  }
  const pkg = unitInfo.packages.find((p) => String(p.uom?._id ?? p.uom) === String(uom));
  if (!pkg) throw new HttpError(`${unitInfo.sku} has no selling package with that unit`, 400);
  if (pkg.isActive === false && !allowInactive) throw new HttpError(`${unitInfo.sku}: package ${pkg.uom?.code || ''} is inactive`, 400);
  return { uom: pkg.uom?._id ?? pkg.uom, code: pkg.uom?.code || '', konversi: pkg.konversi, pkg };
};

/**
 * Harga per satuan jual untuk customer. items = [{ sku, uom }] -> Map unitKey(sku, uom kemasan | null) ->
 * { price, source: 'list' | 'default', priceList?, konversi, uom, code }.
 * Urutan: price list customer (SKU + satuan) -> harga kemasan -> isi x harga satuan dasar (price list / SKU).
 */
const resolveUnitPrices = async (customerId, items) => {
  const units = await loadUnits(items.map((i) => i.sku));
  let list = null;
  if (customerId && mongoose.isValidObjectId(customerId)) {
    const customer = await Customer.findById(customerId).select('priceList').lean();
    if (customer?.priceList) list = await PriceList.findOne({ _id: customer.priceList, isActive: true }).select('code name items').lean();
  }
  const listPrice = new Map((list?.items || []).map((it) => [unitKey(it.sku, it.uom), it.price]));
  const meta = list ? { _id: list._id, code: list.code, name: list.name } : undefined;
  const out = new Map();
  for (const it of items) {
    const info = units.get(String(it.sku));
    if (!info) continue;
    let unit;
    try {
      unit = unitOf(info, it.uom, { allowInactive: true });
    } catch {
      continue;
    }
    const baseKey = unitKey(it.sku, null);
    const base = listPrice.has(baseKey) ? { price: listPrice.get(baseKey), source: 'list' } : { price: info.hargaJual, source: 'default' };
    let result;
    if (!unit.pkg) result = base;
    else if (listPrice.has(unitKey(it.sku, unit.uom))) result = { price: listPrice.get(unitKey(it.sku, unit.uom)), source: 'list' };
    else if (unit.pkg.hargaJual !== null && unit.pkg.hargaJual !== undefined) result = { price: unit.pkg.hargaJual, source: 'default' };
    else result = { price: round2(base.price * unit.konversi), source: base.source };
    out.set(unitKey(it.sku, unit.pkg ? unit.uom : null), {
      ...result, ...(result.source === 'list' ? { priceList: meta } : {}), konversi: unit.konversi, uom: unit.uom, code: unit.code,
    });
  }
  return out;
};

/** Harga untuk baris (setelah applyUnits): Map dari resolveUnitPrices -> harga baris */
const priceForLine = (prices, l) => prices.get(unitKey(l.sku, l.konversi > 1 || l.isPackage ? l.uom : null))?.price;

/**
 * Lengkapi baris dokumen (di dalam transaksi): satuan jual sah, isi dari master (input klien diabaikan),
 * qtyUom = input qty dalam satuan jual (bulat untuk kemasan), qty = qtyUom x isi (satuan dasar).
 * Baris unik per SKU + satuan. units = hasil loadUnits. Mengisi l.uom, l.konversi, l.qtyUom, l.qty, l.produk, l.isPackage.
 */
const applyUnits = (lines, units, { allowInactive = false } = {}) => {
  const seen = new Set();
  lines.forEach((l, i) => {
    const info = units.get(String(l.sku));
    if (!info) throw new HttpError('One or more SKUs no longer exist', 400);
    const unit = unitOf(info, l.uom, { allowInactive });
    const key = unitKey(l.sku, unit.pkg ? unit.uom : null);
    if (seen.has(key)) throw new HttpError(`Line ${i + 1}: ${info.sku} ${unit.code} appears more than once`, 400);
    seen.add(key);
    const qtyUom = Number(l.qtyUom ?? l.qty);
    if (unit.pkg && !Number.isInteger(qtyUom)) throw new HttpError(`Line ${i + 1}: quantity in ${unit.code} must be a whole number`, 400);
    l.uom = unit.uom;
    l.konversi = unit.konversi;
    l.qtyUom = round2(qtyUom);
    l.qty = round2(qtyUom * unit.konversi);
    l.produk = info.produk;
    Object.defineProperty(l, 'isPackage', { value: !!unit.pkg, enumerable: false, configurable: true });
  });
  return lines;
};

/**
 * Pilihan satuan jual per SKU untuk form (satuan dasar + kemasan aktif) dengan harga customer:
 * Map skuId -> [{ uom: { _id, code }, konversi, price, priceSource, isBase }]
 */
const unitOptions = async (customerId, skuIds) => {
  const units = await loadUnits(skuIds);
  const items = [];
  units.forEach((info, id) => {
    items.push({ sku: id, uom: null });
    info.packages.filter((p) => p.isActive !== false).forEach((p) => items.push({ sku: id, uom: p.uom?._id ?? p.uom }));
  });
  const prices = await resolveUnitPrices(customerId, items);
  const out = new Map();
  units.forEach((info, id) => {
    const base = prices.get(unitKey(id, null));
    const list = [{ uom: info.baseUom, konversi: 1, price: base?.price ?? info.hargaJual, priceSource: base?.source || 'default', isBase: true }];
    info.packages.filter((p) => p.isActive !== false).sort((a, b) => a.konversi - b.konversi).forEach((p) => {
      const pr = prices.get(unitKey(id, p.uom?._id ?? p.uom));
      list.push({ uom: p.uom, konversi: p.konversi, price: pr?.price ?? 0, priceSource: pr?.source || 'default', isBase: false });
    });
    out.set(id, list);
  });
  return out;
};

/**
 * Endpoint harga (POST .../skus/prices): body { customer, items: [{ sku, uom }] } -> { unitKey: { price, source } }
 * (body lama { customer, skus: [id] } -> { skuId: { price, source } } satuan dasar)
 */
const pricesResponse = async (body, maxLines) => {
  if (Array.isArray(body.items)) {
    const items = body.items.filter((i) => mongoose.isValidObjectId(i?.sku) && (!i.uom || mongoose.isValidObjectId(i.uom))).slice(0, maxLines);
    const prices = await resolveUnitPrices(body.customer, items);
    return Object.fromEntries([...prices.entries()].map(([k, p]) => [k, { price: p.price, source: p.source }]));
  }
  const ids = (Array.isArray(body.skus) ? body.skus : []).filter((id) => mongoose.isValidObjectId(id)).slice(0, maxLines);
  const prices = await resolveUnitPrices(body.customer, ids.map((sku) => ({ sku, uom: null })));
  return Object.fromEntries(ids.map((id) => [String(id), prices.get(unitKey(id, null))]).filter(([, p]) => p).map(([id, p]) => [id, { price: p.price, source: p.source }]));
};

module.exports = { unitOptions, pricesResponse, unitKey, qtyUomOf, konversiOf, loadUnits, unitOf, resolveUnitPrices, priceForLine, applyUnits };
