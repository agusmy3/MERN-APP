const Uom = require('../models/Uom');
const Produk = require('../models/Produk');
const VendorPrice = require('../models/VendorPrice');
const { HttpError } = require('./transaction');
const { UOM_TYPES, canConvert } = require('../config/uom');

const typeLabel = (t) => UOM_TYPES[t] || 'no type';

/**
 * Pesan error jika satuan beli tidak bisa dikonversi ke satuan dasar produk, atau null.
 * purchase / base = { _id, code, type }
 */
const conversionError = (purchase, base, konversi) => {
  if (!purchase || !base) return null;
  if (String(purchase._id) === String(base._id)) {
    return Number(konversi) === 1 ? null : `Conversion must be 1 when the purchase UoM is the base UoM (${base.code})`;
  }
  if (!canConvert(purchase.type, base.type)) {
    return `${purchase.code} (${typeLabel(purchase.type)}) cannot be converted to ${base.code} (${typeLabel(base.type)}): `
      + 'the content is not fixed. Use a unit of the same type, a package unit (BOX, DUS, SAK...), or change the product\'s base UoM';
  }
  return null;
};

/** Lempar HttpError 400 jika ada pasangan yang tidak valid. pairs = [{ purchaseId, baseId, konversi, label? }] */
const assertConvertible = async (pairs) => {
  const ids = [...new Set(pairs.flatMap((p) => [String(p.purchaseId), String(p.baseId)]))];
  const uoms = new Map((await Uom.find({ _id: { $in: ids } }).select('code type').lean()).map((u) => [String(u._id), u]));
  for (const p of pairs) {
    const err = conversionError(uoms.get(String(p.purchaseId)), uoms.get(String(p.baseId)), p.konversi);
    if (err) throw new HttpError(p.label ? `${p.label}: ${err}` : err, 400);
  }
};

/**
 * Harga vendor yang menjadi tidak valid bila jenis UoM `uomId` diganti ke `newType`
 * (sebagai satuan beli maupun sebagai satuan dasar produk). Return daftar teks singkat.
 */
const typeChangeConflicts = async (uomId, newType) => {
  const produkIds = await Produk.find({ uom: uomId }).distinct('_id');
  const prices = await VendorPrice.find({ $or: [{ uomBeli: uomId }, { produk: { $in: produkIds } }] })
    .select('uomBeli produk sku')
    .populate('uomBeli', 'code type')
    .populate({ path: 'produk', select: 'name uom', populate: { path: 'uom', select: 'code type' } })
    .populate('sku', 'sku')
    .lean();
  const typeOf = (u) => (String(u?._id) === String(uomId) ? newType : u?.type);
  return prices
    .filter((p) => p.uomBeli && p.produk?.uom && String(p.uomBeli._id) !== String(p.produk.uom._id))
    .filter((p) => !canConvert(typeOf(p.uomBeli), typeOf(p.produk.uom)))
    .map((p) => `${p.sku?.sku || p.produk.name} (${p.uomBeli.code} -> ${p.produk.uom.code})`);
};

module.exports = { conversionError, assertConvertible, typeChangeConflicts };
