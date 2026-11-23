/**
 * Isi HPP awal (ProdukSku.avgCost) untuk SKU yang belum punya — aman dijalankan berulang kali.
 *   cd backend && npm run migrate:avg-cost
 *
 * HPP awal = harga per satuan dasar dari vendor utama (isPreferred), atau yang termurah jika
 * tidak ada vendor utama: hargaBeli / konversi, dibulatkan 2 desimal.
 * SKU tanpa harga vendor dibiarkan kosong (null): HPP-nya terisi saat Goods Receipt pertama.
 * Setelah ini HPP hanya berubah lewat Goods Receipt (lihat helpers/stockHelper.js).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { round2 } = require('../helpers/number');
const ProdukSku = require('../models/ProdukSku');
const VendorPrice = require('../models/VendorPrice');

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB\n');

  const skus = await ProdukSku.find({ $or: [{ avgCost: null }, { avgCost: { $exists: false } }] })
    .select('sku stok').lean();
  if (!skus.length) {
    console.log('[=] Semua SKU sudah punya HPP');
    return;
  }

  const costs = await VendorPrice.aggregate([
    { $match: { sku: { $in: skus.map((s) => s._id) } } },
    { $project: { sku: 1, isPreferred: 1, unitCost: { $divide: ['$hargaBeli', '$konversi'] } } },
    {
      $group: {
        _id: '$sku',
        minUnitCost: { $min: '$unitCost' },
        preferredUnitCost: { $max: { $cond: ['$isPreferred', '$unitCost', null] } },
      }
    },
  ]);
  const costMap = new Map(costs.map((c) => [String(c._id), c.preferredUnitCost ?? c.minUnitCost]));

  const updates = [];
  const missing = [];
  for (const s of skus) {
    const cost = costMap.get(String(s._id));
    if (cost === undefined || cost === null) missing.push(s);
    else updates.push({ s, cost: round2(cost) });
  }

  if (updates.length) {
    // hanya SKU yang MASIH kosong (aman bila ada GR yang mengisi HPP bersamaan)
    await ProdukSku.bulkWrite(updates.map(({ s, cost }) => ({
      updateOne: {
        filter: { _id: s._id, $or: [{ avgCost: null }, { avgCost: { $exists: false } }] },
        update: { $set: { avgCost: cost } },
      },
    })));
    console.log(`[+] HPP awal diisi untuk ${updates.length} SKU:`);
    updates.forEach(({ s, cost }) => console.log(`    - ${s.sku}: ${cost}`));
  }
  if (missing.length) {
    console.log(`\n[i] ${missing.length} SKU tanpa harga vendor (HPP kosong sampai Goods Receipt pertama):`);
    missing.forEach((s) => console.log(`    - ${s.sku}${s.stok ? ` (stok ${s.stok})` : ''}`));
  }
  console.log('\nSelesai.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
