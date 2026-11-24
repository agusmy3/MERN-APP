/**
 * Data CONTOH untuk demo / testing manual — hanya untuk database yang BELUM punya produk.
 *   cd backend && npm run db:init -- --email=... --password=...   (sekali, untuk admin & menu)
 *   cd backend && npm run seed:demo
 *
 * Isi: kategori, UoM, varian, 3 vendor, 2 gudang, 4 produk (12 SKU) + harga vendor,
 * stok awal lewat dokumen Saldo Awal (kartu stok & HPP terisi), batas reorder (ada yang kritis),
 * 1 PO terbuka yang terlambat, dan 1 draft adjustment. Semua nama perusahaan fiktif.
 *
 * Ditolak bila sudah ada produk (supaya tidak tercampur data asli). Semua dalam 1 transaksi + audit log.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const mongoose = require('mongoose');
const { runInTransaction } = require('../helpers/transaction');
const { applyMovements, nextDocNo } = require('../helpers/stockHelper');
const { buildComboKey, generateSkuCode, cartesian } = require('../helpers/skuHelper');
const { lineSubtotal, poTotals } = require('../helpers/purchaseHelper');
const { getSettings } = require('../helpers/settings');
const audit = require('../helpers/auditLogger');
const User = require('../models/User');
const Role = require('../models/Role');
const Kategori = require('../models/Kategori');
const Uom = require('../models/Uom');
const Variant = require('../models/Variant');
const Vendor = require('../models/Vendor');
const Gudang = require('../models/Gudang');
const Produk = require('../models/Produk');
const ProdukSku = require('../models/ProdukSku');
const VendorPrice = require('../models/VendorPrice');
const StockAdjustment = require('../models/StockAdjustment');
const PurchaseOrder = require('../models/PurchaseOrder');
const ReorderRule = require('../models/ReorderRule');

const DAY = 24 * 60 * 60 * 1000;

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB\n');

  if (await Produk.countDocuments()) {
    throw new Error('Database sudah berisi produk. seed:demo hanya untuk database kosong (supaya tidak tercampur data asli).');
  }
  const role = await Role.findOne({ isSystem: true });
  const admin = role && await User.findOne({ role: role._id, isActive: { $ne: false } }).sort({ createdDate: 1 });
  if (!admin) throw new Error('Belum ada Super Admin. Jalankan dulu: npm run db:init -- --email=<email> --password=<password>');
  const req = { user: { _id: admin._id, name: `${admin.name} (seed:demo)` }, headers: {}, ip: null };
  const by = { createdBy: admin._id };

  const summary = await runInTransaction(async () => {
    const batchId = audit.newBatchId();
    const log = (entity, docs) => audit.logCreate(req, entity, docs, { batchId });
    const findOrCreate = async (Model, entity, filter, data) => {
      const found = await Model.findOne(filter);
      if (found) return found;
      const doc = await Model.create({ ...filter, ...data, ...by });
      await log(entity, [doc]);
      return doc;
    };

    // ---------- master ----------
    const kat = {
      pakaian: await findOrCreate(Kategori, 'kategori', { name: 'Pakaian' }, { deskripsi: 'Pakaian & aksesoris' }),
      elektronik: await findOrCreate(Kategori, 'kategori', { name: 'Elektronik' }, { deskripsi: 'Peralatan elektronik rumah tangga' }),
      makanan: await findOrCreate(Kategori, 'kategori', { name: 'Makanan & Minuman' }, { deskripsi: 'Produk konsumsi' }),
    };
    const uom = {
      pcs: await findOrCreate(Uom, 'uom', { code: 'PCS' }, { name: 'Pieces', deskripsi: 'Satuan per buah' }),
      box: await findOrCreate(Uom, 'uom', { code: 'BOX' }, { name: 'Box' }),
      dus: await findOrCreate(Uom, 'uom', { code: 'DUS' }, { name: 'Dus / Karton' }),
      kg: await findOrCreate(Uom, 'uom', { code: 'KG' }, { name: 'Kilogram' }),
      sak: await findOrCreate(Uom, 'uom', { code: 'SAK' }, { name: 'Sak (25 kg)' }),
    };
    const color = await findOrCreate(Variant, 'variant', { code: 'COLOR' }, { name: 'Warna', values: ['Merah', 'Biru', 'Hitam'] });
    const size = await findOrCreate(Variant, 'variant', { code: 'SIZE' }, { name: 'Ukuran', values: ['S', 'M', 'L'] });
    const vendor = {
      sandang: await findOrCreate(Vendor, 'vendor', { companyName: 'CV Sandang Makmur (Demo)' }, { picName: 'Budi', picContact: '0812-0000-0001', companyAddress: 'Jl. Contoh No. 1, Bandung' }),
      elektro: await findOrCreate(Vendor, 'vendor', { companyName: 'PT Elektro Sentosa (Demo)' }, { picName: 'Sari', picContact: '0812-0000-0002', companyAddress: 'Jl. Contoh No. 2, Jakarta' }),
      pangan: await findOrCreate(Vendor, 'vendor', { companyName: 'UD Pangan Jaya (Demo)' }, { picName: 'Andi', picContact: '0812-0000-0003', companyAddress: 'Jl. Contoh No. 3, Surabaya' }),
    };
    const gudang = {
      main: await findOrCreate(Gudang, 'gudang', { code: 'MAIN' }, {
        name: 'Gudang Utama', alamat: 'Jl. Gudang No. 10', provinsi: 'DKI Jakarta', kota: 'Jakarta Selatan',
        kecamatan: 'Kebayoran Baru', kodePos: '12160', latitude: -6.2441, longitude: 106.7991,
      }),
      sby: await findOrCreate(Gudang, 'gudang', { code: 'SBY' }, {
        name: 'Gudang Surabaya', alamat: 'Jl. Gudang No. 20', provinsi: 'Jawa Timur', kota: 'Surabaya',
        kecamatan: 'Genteng', kodePos: '60275', latitude: -7.2575, longitude: 112.7521,
      }),
    };

    // ---------- produk & SKU ----------
    const taken = new Set();
    const makeProduct = async ({ name, deskripsi, kategori, baseUom, variants = [], price, priceFor }) => {
      const produk = await Produk.create({ name, deskripsi, kategori: kategori._id, uom: baseUom._id, variants: variants.map((v) => v._id), ...by });
      await log('produk', [produk]);
      const combos = variants.length
        ? cartesian(variants.map((v) => v.values.map((value) => ({ variant: v._id, value }))))
        : [[]];
      const skus = [];
      for (const combo of combos) {
        skus.push(await ProdukSku.create({
          produk: produk._id,
          sku: await generateSkuCode(name, combo.map((c) => c.value), taken),
          variantValues: combo,
          comboKey: buildComboKey(combo),
          hargaJual: priceFor ? priceFor(combo) : price,
          ...by,
        }));
      }
      skus.forEach((s) => taken.add(s.sku));
      await log('produkSku', skus);
      return { produk, skus };
    };

    const kaos = await makeProduct({
      name: 'Kaos Polos', deskripsi: 'Kaos katun combed 30s', kategori: kat.pakaian, baseUom: uom.pcs, variants: [color, size],
      priceFor: (combo) => (combo.some((c) => c.value === 'L') ? 70000 : 65000),
    });
    const kipas = await makeProduct({ name: 'Kipas Angin Meja', deskripsi: '16 inci, 3 kecepatan', kategori: kat.elektronik, baseUom: uom.pcs, price: 275000 });
    const keripik = await makeProduct({ name: 'Keripik Singkong 250g', deskripsi: 'Rasa original', kategori: kat.makanan, baseUom: uom.pcs, price: 15000 });
    const beras = await makeProduct({ name: 'Beras Premium', deskripsi: 'Dijual per kg', kategori: kat.makanan, baseUom: uom.kg, price: 16500 });

    // ---------- harga vendor (vendor utama) ----------
    const prices = [];
    const addPrice = (v, sku, uomBeli, konversi, hargaBeli, extra = {}) => prices.push({
      vendor: v._id, produk: sku.produk, sku: sku._id, uomBeli: uomBeli._id, konversi, hargaBeli, isPreferred: true, ...extra, ...by,
    });
    kaos.skus.forEach((s) => addPrice(vendor.sandang, s, uom.box, 12, 420000, { minOrder: 1 }));   // 35.000 / pcs
    addPrice(vendor.elektro, kipas.skus[0], uom.pcs, 1, 180000);
    addPrice(vendor.pangan, keripik.skus[0], uom.dus, 24, 216000, { minOrder: 2 });                 // 9.000 / pcs
    addPrice(vendor.pangan, beras.skus[0], uom.sak, 25, 312500);                                    // 12.500 / kg
    const vps = await VendorPrice.insertMany(prices);
    await log('vendorPrice', vps);

    // ---------- stok awal (dokumen Saldo Awal, POSTED) ----------
    const opening = async (g, lines) => {
      const now = new Date();
      const doc = await StockAdjustment.create({
        no: await nextDocNo('ADJ', now), type: 'ADJUSTMENT', gudang: g._id, date: now, reason: 'OPENING',
        note: 'Data contoh (seed:demo)', status: 'POSTED', postedBy: admin._id, postedDate: now, ...by,
        lines: lines.map((l) => ({ sku: l.sku._id, produk: l.sku.produk, qtySystem: 0, qtyChange: l.qty, unitCost: l.cost })),
      });
      await applyMovements(req, lines.map((l) => ({
        sku: l.sku._id, gudang: g._id, qty: l.qty, unitCost: l.cost, type: 'OPENING', reason: 'OPENING', note: doc.note,
      })), { refType: 'StockAdjustment', refId: doc._id, refNo: doc.no });
      await log('stockAdjustment', [doc]);
      return doc;
    };
    const kaosQty = [24, 6, 18, 30, 12, 4, 15, 9, 20]; // beberapa di bawah minimum -> reorder alert
    await opening(gudang.main, [
      ...kaos.skus.map((s, i) => ({ sku: s, qty: kaosQty[i], cost: 35000 })),
      { sku: kipas.skus[0], qty: 8, cost: 180000 },
      { sku: keripik.skus[0], qty: 120, cost: 9000 },
      { sku: beras.skus[0], qty: 250.5, cost: 12500 },
    ]);
    await opening(gudang.sby, [
      { sku: kaos.skus[0], qty: 10, cost: 36000 },
      { sku: keripik.skus[0], qty: 48, cost: 9200 },
    ]);

    // ---------- batas reorder ----------
    const rules = await ReorderRule.insertMany([
      ...kaos.skus.map((s) => ({ sku: s._id, produk: s.produk, gudang: gudang.main._id, minQty: 10, maxQty: 40, ...by })),
      { sku: kipas.skus[0]._id, produk: kipas.produk._id, gudang: gudang.main._id, minQty: 10, maxQty: 30, ...by },
      { sku: keripik.skus[0]._id, produk: keripik.produk._id, gudang: gudang.main._id, minQty: 48, maxQty: 240, ...by },
      { sku: keripik.skus[0]._id, produk: keripik.produk._id, gudang: gudang.sby._id, minQty: 24, maxQty: 96, ...by },
    ]);
    await log('reorderRule', rules);

    // ---------- PO terbuka yang terlambat (kipas: status reorder jadi "On order") ----------
    const settings = await getSettings();
    const poLine = { sku: kipas.skus[0]._id, produk: kipas.produk._id, uomBeli: uom.pcs._id, konversi: 1, qty: 10, hargaBeli: 180000, diskonPersen: 0 };
    poLine.subtotal = lineSubtotal(poLine);
    const taxRate = settings['tax.ppnRate'] ?? 11;
    const po = await PurchaseOrder.create({
      no: await nextDocNo('PO'), vendor: vendor.elektro._id, gudang: gudang.main._id,
      date: new Date(Date.now() - 5 * DAY), expectedDate: new Date(Date.now() - 1 * DAY),
      status: 'OPEN', isPKP: settings['tax.isPKP'] !== false, taxRate, lines: [poLine], ...poTotals([poLine], taxRate),
      note: 'Data contoh (seed:demo)', issuedBy: admin._id, issuedDate: new Date(Date.now() - 5 * DAY), ...by,
    });
    await log('purchaseOrder', [po]);

    // ---------- draft yang menunggu diposting ----------
    const draft = await StockAdjustment.create({
      no: await nextDocNo('ADJ'), type: 'ADJUSTMENT', gudang: gudang.main._id, date: new Date(), reason: 'DAMAGED',
      note: 'Kemasan sobek (contoh draft)', status: 'DRAFT', ...by,
      lines: [{ sku: keripik.skus[0]._id, produk: keripik.produk._id, qtyChange: -3 }],
    });
    await log('stockAdjustment', [draft]);

    return { skus: kaos.skus.length + 3, po: po.no };
  });

  console.log(`[+] Data contoh dibuat: 4 produk, ${summary.skus} SKU, 2 gudang, 3 vendor, stok awal, batas reorder, ${summary.po} (terlambat), 1 draft adjustment.`);
  console.log('\nSelesai.');
}

main()
  .catch((err) => {
    console.error(`[!] ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
