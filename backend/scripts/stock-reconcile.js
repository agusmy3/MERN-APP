/**
 * Pemeriksaan integritas stok (pengaman). Kartu stok (StockMovement) = sumber kebenaran.
 *   cd backend && npm run stock:reconcile          -> laporan saja
 *   cd backend && npm run stock:reconcile -- --fix -> perbaiki cache dari movement
 *
 * Dicek:
 * 1. StockBalance.qty  == jumlah qty movement per SKU + gudang
 * 2. ProdukSku.stok    == jumlah saldo semua gudang
 * 3. balanceAfter movement terakhir == saldo gudang
 * --fix menulis ulang StockBalance & ProdukSku.stok dari movement. Jalankan saat aplikasi sepi.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const { round2 } = require('../helpers/number');
const ProdukSku = require('../models/ProdukSku');
const StockBalance = require('../models/StockBalance');
const StockMovement = require('../models/StockMovement');
const Gudang = require('../models/Gudang');

const FIX = process.argv.includes('--fix');

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected to MongoDB${FIX ? ' (mode --fix)' : ''}\n`);

  const ledger = await StockMovement.aggregate([
    { $sort: { date: 1, _id: 1 } },
    {
      $group: {
        _id: { sku: '$sku', gudang: '$gudang' },
        produk: { $first: '$produk' },
        qty: { $sum: '$qty' },
        lastBalance: { $last: '$balanceAfter' },
      }
    },
  ]);
  const balances = await StockBalance.find().lean();
  const skus = await ProdukSku.find().select('sku stok produk').lean();
  const skuCode = new Map(skus.map((s) => [String(s._id), s.sku]));
  const gudangCode = new Map((await Gudang.find().select('code').lean()).map((g) => [String(g._id), g.code]));
  const key = (sku, gudang) => `${sku}:${gudang}`;

  const expected = new Map(ledger.map((l) => [key(l._id.sku, l._id.gudang), { ...l, qty: round2(l.qty) }]));
  const actual = new Map(balances.map((b) => [key(b.sku, b.gudang), b]));
  const problems = [];

  // 1 & 3: saldo per gudang
  for (const k of new Set([...expected.keys(), ...actual.keys()])) {
    const e = expected.get(k);
    const a = actual.get(k);
    const want = e?.qty || 0;
    const have = round2(a?.qty || 0);
    const [sku, gudang] = k.split(':');
    if (want !== have) problems.push(`Saldo ${skuCode.get(sku) || sku} @ ${gudangCode.get(gudang) || gudang}: tercatat ${have}, seharusnya ${want}`);
    if (e && round2(e.lastBalance) !== want) {
      problems.push(`balanceAfter terakhir ${skuCode.get(sku) || sku}: ${e.lastBalance}, jumlah movement ${want}`);
    }
  }

  // 2: total per SKU
  const totalPerSku = new Map();
  for (const e of expected.values()) {
    const id = String(e._id.sku);
    totalPerSku.set(id, round2((totalPerSku.get(id) || 0) + e.qty));
  }
  for (const s of skus) {
    const want = totalPerSku.get(String(s._id)) || 0;
    if (round2(s.stok || 0) !== want) problems.push(`Stok SKU ${s.sku}: tercatat ${s.stok || 0}, seharusnya ${want}`);
  }

  if (!problems.length) {
    console.log(`[OK] ${expected.size} saldo gudang & ${skus.length} SKU sesuai dengan kartu stok.`);
    return;
  }
  console.log(`[!] ${problems.length} selisih:`);
  problems.forEach((p) => console.log(`    - ${p}`));

  if (!FIX) {
    console.log('\nJalankan dengan --fix untuk menulis ulang saldo dari kartu stok.');
    process.exitCode = 1;
    return;
  }

  const now = new Date();
  await StockBalance.bulkWrite([
    ...[...expected.values()].map((e) => ({
      updateOne: {
        filter: { sku: e._id.sku, gudang: e._id.gudang },
        update: { $set: { qty: Math.max(e.qty, 0), produk: e.produk, updatedDate: now } },
        upsert: true,
      },
    })),
    ...[...actual.entries()].filter(([k]) => !expected.has(k)).map(([, b]) => ({
      updateOne: { filter: { _id: b._id }, update: { $set: { qty: 0, updatedDate: now } } },
    })),
  ]);
  await ProdukSku.bulkWrite(skus.map((s) => ({
    updateOne: { filter: { _id: s._id }, update: { $set: { stok: Math.max(totalPerSku.get(String(s._id)) || 0, 0) } } },
  })));
  console.log('\n[+] Saldo gudang & stok SKU ditulis ulang dari kartu stok.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
