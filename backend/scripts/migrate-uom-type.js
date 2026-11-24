/**
 * Isi jenis UoM (Uom.type) yang masih kosong dari kodenya — aman dijalankan berulang kali.
 *   cd backend && npm run migrate:uom-type
 *
 * Tebakan per kode ada di config/uom.js (PCS -> Count, KG -> Weight, BOX/DUS/SAK -> Package, ...).
 * Kode yang tidak dikenal dibiarkan kosong (konversinya tidak dicek) dan ditampilkan di akhir:
 * isi manual di menu UoM. Lalu dilaporkan harga vendor yang konversinya tidak masuk akal
 * (mis. KG -> PCS) untuk diperbaiki di tab Vendor Prices produk.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const mongoose = require('mongoose');
const Uom = require('../models/Uom');
const VendorPrice = require('../models/VendorPrice');
require('../models/Produk');
require('../models/ProdukSku');
const { UOM_TYPES, canConvert, guessType } = require('../config/uom');

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  const empty = await Uom.find({ $or: [{ type: null }, { type: { $exists: false } }] }).select('code').lean();
  const unknown = [];
  for (const u of empty) {
    const type = guessType(u.code);
    if (!type) {
      unknown.push(u.code);
      continue;
    }
    await Uom.updateOne({ _id: u._id }, { type });
    console.log(`[+] ${u.code} -> ${UOM_TYPES[type]}`);
  }
  if (!empty.length) console.log('[=] Semua UoM sudah punya jenis');
  if (unknown.length) console.log(`[!] Jenis belum diketahui, isi manual di menu UoM: ${unknown.join(', ')}`);

  const prices = await VendorPrice.find()
    .select('uomBeli produk sku')
    .populate('uomBeli', 'code type')
    .populate({ path: 'produk', select: 'name uom', populate: { path: 'uom', select: 'code type' } })
    .populate('sku', 'sku')
    .lean();
  const bad = prices.filter((p) => p.uomBeli && p.produk?.uom
    && String(p.uomBeli._id) !== String(p.produk.uom._id)
    && !canConvert(p.uomBeli.type, p.produk.uom.type));
  if (bad.length) {
    console.log(`\n[!] ${bad.length} harga vendor dengan konversi antar jenis yang tidak cocok (perbaiki di tab Vendor Prices produk):`);
    bad.forEach((p) => console.log(`    ${p.sku?.sku || p.produk.name}: ${p.uomBeli.code} (${UOM_TYPES[p.uomBeli.type]}) -> ${p.produk.uom.code} (${UOM_TYPES[p.produk.uom.type]})`));
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
