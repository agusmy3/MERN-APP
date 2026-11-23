const ProdukSku = require('../models/ProdukSku');

/** Kunci kombinasi varian, tidak bergantung urutan & huruf besar/kecil. '' = SKU default. */
const buildComboKey = (variantValues = []) => variantValues
  .map((v) => `${String(v.variant)}:${String(v.value).trim().toLowerCase()}`)
  .sort()
  .join('|');

const slug = (text, max) => String(text)
  .toUpperCase()
  .replace(/[^A-Z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, max)
  .replace(/-+$/g, '');

/**
 * Kode SKU otomatis: NAMA-PRODUK-NILAI1-NILAI2, dijamin unik (ditambah -2, -3, ... jika sudah ada).
 * `taken` = Set kode yang sudah dipakai dalam batch yang sama (belum tersimpan).
 */
const generateSkuCode = async (productName, values = [], taken = new Set()) => {
  const parts = [slug(productName, 16) || 'SKU', ...values.map((v) => slug(v, 8)).filter(Boolean)];
  const base = parts.join('-');
  let code = base;
  let n = 2;
  while (taken.has(code) || await ProdukSku.exists({ sku: code })) {
    code = `${base}-${n++}`;
  }
  taken.add(code);
  return code;
};

/** Semua kombinasi: [[a1, a2], [b1]] -> [[a1, b1], [a2, b1]] */
const cartesian = (lists) => lists.reduce(
  (acc, list) => acc.flatMap((combo) => list.map((item) => [...combo, item])),
  [[]]
);

module.exports = { buildComboKey, generateSkuCode, cartesian };
