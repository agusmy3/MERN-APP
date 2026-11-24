/**
 * Migrasi produk lama ke struktur Produk -> SKU -> Harga Vendor. Aman dijalankan berulang kali.
 *   cd backend && npm run migrate:produk-sku
 *
 * Untuk setiap produk lama (masih punya field harga/qty atau belum punya uom):
 * 1. uom diisi PCS (UoM PCS dibuat jika belum ada), variants = [] (produk tanpa varian)
 * 2. dibuatkan 1 SKU default: hargaJual = harga lama, stok = qty lama
 * 3. field lama harga & qty dihapus dari dokumen produk
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Produk = require('../models/Produk');
const ProdukSku = require('../models/ProdukSku');
const Uom = require('../models/Uom');
const User = require('../models/User');
const { generateSkuCode } = require('../helpers/skuHelper');

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB\n');

  const admin = await User.findOne({ email: 'admin@mern.com' }).select('_id').lean();

  let pcs = await Uom.findOne({ code: 'PCS' });
  if (!pcs) {
    pcs = await Uom.create({ code: 'PCS', name: 'Pieces', type: 'COUNT', deskripsi: 'Satuan per buah', createdBy: admin?._id });
    console.log('[+] UoM PCS dibuat');
  } else {
    console.log('[=] UoM PCS sudah ada');
  }

  // baca langsung dari collection: field lama (harga, qty) sudah tidak ada di schema
  const col = Produk.collection;
  const legacy = await col.find({
    $or: [{ harga: { $exists: true } }, { qty: { $exists: true } }, { uom: { $exists: false } }, { uom: null }],
  }).toArray();
  console.log(`[i] ${legacy.length} produk perlu dimigrasi\n`);

  let skuCreated = 0;
  for (const p of legacy) {
    const set = {};
    if (!p.uom) set.uom = pcs._id;
    if (!Array.isArray(p.variants)) set.variants = [];
    await col.updateOne({ _id: p._id }, { $set: set, $unset: { harga: '', qty: '' } });

    const hasSku = await ProdukSku.exists({ produk: p._id });
    if (!hasSku) {
      await ProdukSku.create({
        produk: p._id,
        sku: await generateSkuCode(p.name),
        comboKey: '',
        hargaJual: Number(p.harga) || 0,
        stok: Number(p.qty) || 0,
        createdBy: admin?._id,
      });
      skuCreated++;
    }
    console.log(`[+] ${p.name}${hasSku ? ' (SKU sudah ada)' : ` -> SKU default, harga ${p.harga ?? 0}, stok ${p.qty ?? 0}`}`);
  }

  console.log(`\nSelesai. ${legacy.length} produk dimigrasi, ${skuCreated} SKU default dibuat.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
