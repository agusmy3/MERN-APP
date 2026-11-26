/**
 * DEMO — data contoh lengkap untuk mencoba aplikasi. Jalankan SETELAH `npm run init`, di database
 * yang belum berisi data (ditolak jika sudah ada gudang / produk / transaksi).
 *
 *   cd backend && npm run demo -- --password=DemoPass123 [--pin=1234]
 *   (password semua user demo, atau DEMO_PASSWORD di .env; --pin = PIN POS untuk Store Supervisor demo)
 *
 * Isi (nama perusahaan & orang fiktif):
 * - 2 gudang (MAIN Jakarta, SBY Surabaya) & 2 outlet (TOKO-JKT -> MAIN, TOKO-SBY -> SBY), lokasi lengkap
 * - UoM umum + jenisnya, varian umum (Warna, Ukuran, Rasa, Isi), 4 kategori
 * - 6 produk (bervarian & tanpa varian, satuan PCS / UNIT / KG) + harga jual, barcode, harga vendor
 *   (beli per BOX / DUS / SAK), 3 vendor
 * - stok awal ber-HPP di kedua gudang (dokumen Saldo Awal), batas reorder (ada yang kritis)
 * - customer (termin & price list "Grosir"), 1 user per role (kasir & staff gudang ditugaskan)
 * - transaksi contoh: PO terlambat, draft adjustment, invoice kredit belum dibayar, sales order + 1 surat jalan
 *   belum ditagih, 1 shift POS
 *   tertutup dengan 2 penjualan
 * Semua dalam 1 transaksi + audit log.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const mongoose = require('mongoose');
const { runInTransaction } = require('../helpers/transaction');
const { applyMovements, nextDocNo } = require('../helpers/stockHelper');
const { buildComboKey, generateSkuCode, cartesian } = require('../helpers/skuHelper');
const { lineSubtotal, poTotals } = require('../helpers/purchaseHelper');
const { salesLineSubtotal, salesTotals, invoiceBalance } = require('../helpers/salesHelper');
const { getSettings } = require('../helpers/settings');
const { round2 } = require('../helpers/number');
const audit = require('../helpers/auditLogger');
const { ROLE_TEMPLATES } = require('../config/roles');
const User = require('../models/User');
const Role = require('../models/Role');
const Kategori = require('../models/Kategori');
const Uom = require('../models/Uom');
const Variant = require('../models/Variant');
const Vendor = require('../models/Vendor');
const Gudang = require('../models/Gudang');
const Outlet = require('../models/Outlet');
const Produk = require('../models/Produk');
const ProdukSku = require('../models/ProdukSku');
const VendorPrice = require('../models/VendorPrice');
const StockAdjustment = require('../models/StockAdjustment');
const PurchaseOrder = require('../models/PurchaseOrder');
const ReorderRule = require('../models/ReorderRule');
const Customer = require('../models/Customer');
const PriceList = require('../models/PriceList');
const SalesInvoice = require('../models/SalesInvoice');
const SalesOrder = require('../models/SalesOrder');
const DeliveryOrder = require('../models/DeliveryOrder');
const Quotation = require('../models/Quotation');
const SalesPayment = require('../models/SalesPayment');
const PosShift = require('../models/PosShift');

const DAY = 24 * 60 * 60 * 1000;
const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

// user demo per role (key = config/roles.js); gudangs / outlets diisi setelah dibuat
const DEMO_USERS = [
  { role: 'owner', name: 'Olivia Owner', email: 'owner@demo.local' },
  { role: 'masterData', name: 'Mira Master Data', email: 'masterdata@demo.local' },
  { role: 'warehouseStaff', name: 'Wawan Gudang', email: 'gudang@demo.local', gudangs: ['MAIN'] },
  { role: 'warehouseSupervisor', name: 'Wulan Supervisor Gudang', email: 'spv.gudang@demo.local' },
  { role: 'purchasing', name: 'Putra Purchasing', email: 'purchasing@demo.local' },
  { role: 'salesAdmin', name: 'Sinta Sales', email: 'sales@demo.local' },
  { role: 'finance', name: 'Fajar Finance', email: 'finance@demo.local' },
  { role: 'cashier', name: 'Kiki Kasir Jakarta', email: 'kasir.jkt@demo.local', outlets: ['TOKO-JKT'] },
  { role: 'cashier', name: 'Kevin Kasir Surabaya', email: 'kasir.sby@demo.local', outlets: ['TOKO-SBY'] },
  { role: 'storeSupervisor', name: 'Sari Supervisor Toko', email: 'spv.toko@demo.local', outlets: ['TOKO-JKT', 'TOKO-SBY'] },
];

async function main() {
  const password = String(arg('password') || process.env.DEMO_PASSWORD || '');
  if (password.length < 8) throw new Error('Password user demo minimal 8 karakter. Pakai --password=<password> (atau DEMO_PASSWORD di .env)');
  const pin = arg('pin');
  if (pin !== undefined && !/^\d{4,8}$/.test(pin)) throw new Error('--pin harus 4-8 digit');
  const pinHash = pin ? await require('bcryptjs').hash(pin, 10) : null;
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI belum diisi di backend/.env');

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  console.log(`Database: ${mongoose.connection.name}\n`);

  const superRole = await Role.findOne({ isSystem: true });
  const admin = superRole && await User.findOne({ role: superRole._id, isActive: { $ne: false } }).sort({ createdDate: 1 });
  if (!admin) throw new Error('Belum ada Super Admin. Jalankan dulu: npm run init -- --wipe --email=<email> --password=<password>');
  const [gudangCount, produkCount, invCount, poCount] = await Promise.all([
    Gudang.countDocuments(), Produk.countDocuments(), SalesInvoice.countDocuments(), PurchaseOrder.countDocuments(),
  ]);
  if (gudangCount || produkCount || invCount || poCount) {
    throw new Error('Database sudah berisi data (gudang / produk / transaksi). demo hanya untuk database hasil `npm run init` (supaya tidak tercampur data asli).');
  }
  const roleByName = new Map((await Role.find().lean()).map((r) => [r.name, r]));
  const missing = ROLE_TEMPLATES.filter((t) => !roleByName.has(t.name));
  if (missing.length) throw new Error(`Role standar belum ada (${missing.map((m) => m.name).join(', ')}). Jalankan npm run init.`);
  if (await User.exists({ email: { $in: DEMO_USERS.map((u) => u.email) } })) throw new Error('User demo sudah ada.');

  const req = { user: { _id: admin._id, name: `${admin.name} (demo)` }, headers: {}, ip: null };
  const by = { createdBy: admin._id };

  const summary = await runInTransaction(async () => {
    const batchId = audit.newBatchId();
    const log = (entity, docs) => audit.logCreate(req, entity, docs, { batchId });
    const create = async (Model, entity, data) => {
      const doc = await Model.create({ ...data, ...by });
      await log(entity, [doc]);
      return doc;
    };
    const settings = await getSettings();
    const taxRate = settings['tax.isPKP'] !== false ? (settings['tax.ppnRate'] ?? 0) : 0;

    // ---------- gudang & outlet ----------
    const gudang = {
      main: await create(Gudang, 'gudang', {
        code: 'MAIN', name: 'Gudang Utama Jakarta', alamat: 'Jl. Gudang Raya No. 10', provinsi: 'DKI Jakarta', kota: 'Jakarta Selatan',
        kecamatan: 'Kebayoran Baru', kodePos: '12160', latitude: -6.2441, longitude: 106.7991,
      }),
      sby: await create(Gudang, 'gudang', {
        code: 'SBY', name: 'Gudang Surabaya', alamat: 'Jl. Gudang Timur No. 20', provinsi: 'Jawa Timur', kota: 'Surabaya',
        kecamatan: 'Genteng', kodePos: '60275', latitude: -7.2575, longitude: 112.7521,
      }),
    };
    const outlet = {
      jkt: await create(Outlet, 'outlet', {
        code: 'TOKO-JKT', name: 'Toko Jakarta (Demo)', gudang: gudang.main._id, phone: '021-5550-0001',
        alamat: 'Jl. Pasar Baru No. 5', provinsi: 'DKI Jakarta', kota: 'Jakarta Pusat', kecamatan: 'Sawah Besar', kodePos: '10710',
        latitude: -6.1615, longitude: 106.8338, receiptHeader: 'TOKO DEMO\nNPWP 00.000.000.0-000.000', receiptFooter: 'Terima kasih atas kunjungan Anda',
      }),
      sby: await create(Outlet, 'outlet', {
        code: 'TOKO-SBY', name: 'Toko Surabaya (Demo)', gudang: gudang.sby._id, phone: '031-5550-0002',
        alamat: 'Jl. Tunjungan No. 12', provinsi: 'Jawa Timur', kota: 'Surabaya', kecamatan: 'Genteng', kodePos: '60275',
        latitude: -7.2620, longitude: 112.7408, receiptFooter: 'Barang yang sudah dibeli dapat ditukar dalam 3 hari dengan struk', receiptWidth: 80,
      }),
    };

    // ---------- UoM, varian, kategori, vendor ----------
    const uomDefs = [
      ['PCS', 'Pieces', 'COUNT'], ['UNIT', 'Unit', 'COUNT'],
      ['KG', 'Kilogram', 'WEIGHT'], ['GRAM', 'Gram', 'WEIGHT'],
      ['LITER', 'Liter', 'VOLUME'], ['ML', 'Mililiter', 'VOLUME'],
      ['METER', 'Meter', 'LENGTH'],
      ['BOX', 'Box', 'PACK'], ['DUS', 'Dus / Karton', 'PACK'], ['PACK', 'Pack', 'PACK'], ['LUSIN', 'Lusin', 'PACK'], ['SAK', 'Sak / Karung', 'PACK'],
    ];
    const uom = {};
    for (const [code, name, type] of uomDefs) uom[code] = await create(Uom, 'uom', { code, name, type });

    const variant = {
      color: await create(Variant, 'variant', { code: 'COLOR', name: 'Warna', values: ['Hitam', 'Putih', 'Merah'] }),
      size: await create(Variant, 'variant', { code: 'SIZE', name: 'Ukuran', values: ['S', 'M', 'L', 'XL'] }),
      flavor: await create(Variant, 'variant', { code: 'FLAVOR', name: 'Rasa', values: ['Original', 'Pedas', 'Balado'] }),
      volume: await create(Variant, 'variant', { code: 'VOLUME', name: 'Isi', values: ['600 ml', '1500 ml'] }),
    };
    const kat = {
      pakaian: await create(Kategori, 'kategori', { name: 'Pakaian', deskripsi: 'Pakaian & aksesoris' }),
      makanan: await create(Kategori, 'kategori', { name: 'Makanan & Minuman', deskripsi: 'Produk konsumsi' }),
      elektronik: await create(Kategori, 'kategori', { name: 'Elektronik', deskripsi: 'Peralatan elektronik rumah tangga' }),
      sembako: await create(Kategori, 'kategori', { name: 'Sembako', deskripsi: 'Kebutuhan pokok, dijual per berat' }),
    };
    const vendor = {
      sandang: await create(Vendor, 'vendor', { companyName: 'CV Sandang Makmur (Demo)', picName: 'Budi', picContact: '0812-0000-0001', companyAddress: 'Jl. Contoh No. 1', provinsi: 'Jawa Barat', kota: 'Bandung', kecamatan: 'Coblong', kodePos: '40132', termDays: 30 }),
      elektro: await create(Vendor, 'vendor', { companyName: 'PT Elektro Sentosa (Demo)', picName: 'Sari', picContact: '0812-0000-0002', companyAddress: 'Jl. Contoh No. 2', provinsi: 'DKI Jakarta', kota: 'Jakarta Utara', kecamatan: 'Penjaringan', kodePos: '14440', termDays: 14 }),
      pangan: await create(Vendor, 'vendor', { companyName: 'UD Pangan Jaya (Demo)', picName: 'Andi', picContact: '0812-0000-0003', companyAddress: 'Jl. Contoh No. 3', provinsi: 'Jawa Timur', kota: 'Surabaya', kecamatan: 'Genteng', kodePos: '60275' }),
    };

    // ---------- produk & SKU (harga jual + barcode) ----------
    const taken = new Set();
    let barcodeSeq = 1;
    const makeProduct = async ({ name, deskripsi, kategori, baseUom, variants = [], priceFor }) => {
      const produk = await Produk.create({ name, deskripsi, kategori: kategori._id, uom: baseUom._id, variants: variants.map((v) => v._id), ...by });
      await log('produk', [produk]);
      const combos = variants.length ? cartesian(variants.map((v) => v.values.map((value) => ({ variant: v._id, value })))) : [[]];
      const skus = [];
      for (const combo of combos) {
        skus.push(await ProdukSku.create({
          produk: produk._id,
          sku: await generateSkuCode(name, combo.map((c) => c.value), taken),
          variantValues: combo,
          comboKey: buildComboKey(combo),
          hargaJual: priceFor(combo.map((c) => c.value)),
          barcode: `899${String(barcodeSeq++).padStart(10, '0')}`, // barcode contoh (bukan EAN resmi)
          ...by,
        }));
        taken.add(skus[skus.length - 1].sku);
      }
      await log('produkSku', skus);
      return { produk, skus, by: (...values) => skus.find((s) => values.every((v) => s.variantValues.some((vv) => vv.value === v))) };
    };
    const p = {
      kaos: await makeProduct({
        name: 'Kaos Polos', deskripsi: 'Kaos katun combed 30s', kategori: kat.pakaian, baseUom: uom.PCS, variants: [variant.color, variant.size],
        priceFor: (v) => (v.includes('XL') ? 75000 : 65000),
      }),
      keripik: await makeProduct({
        name: 'Keripik Singkong 250g', deskripsi: 'Keripik singkong renyah', kategori: kat.makanan, baseUom: uom.PCS, variants: [variant.flavor],
        priceFor: () => 15000,
      }),
      air: await makeProduct({
        name: 'Air Mineral', deskripsi: 'Air mineral kemasan botol', kategori: kat.makanan, baseUom: uom.PCS, variants: [variant.volume],
        priceFor: (v) => (v.includes('600 ml') ? 4000 : 7000),
      }),
      kipas: await makeProduct({ name: 'Kipas Angin Meja', deskripsi: '16 inci, 3 kecepatan', kategori: kat.elektronik, baseUom: uom.UNIT, priceFor: () => 275000 }),
      beras: await makeProduct({ name: 'Beras Premium', deskripsi: 'Dijual per kg, dibeli per sak 25 kg', kategori: kat.sembako, baseUom: uom.KG, priceFor: () => 16500 }),
      gula: await makeProduct({ name: 'Gula Pasir', deskripsi: 'Dijual per kg, dibeli per sak 50 kg', kategori: kat.sembako, baseUom: uom.KG, priceFor: () => 18000 }),
    };

    // ---------- kemasan jual (dijual per DUS / PACK selain per pcs) ----------
    const setPackages = async (sku, packages) => {
      const doc = await ProdukSku.findById(sku._id);
      const before = await audit.snap('produkSku', [doc]);
      doc.packages = packages.map(([u, konversi, hargaJual, barcode = null]) => ({ uom: u._id, konversi, hargaJual, barcode }));
      await doc.save();
      await audit.logUpdate(req, 'produkSku', before, [doc]);
      sku.packages = doc.packages;
    };
    await setPackages(p.air.by('600 ml'), [[uom.PACK, 6, 22000], [uom.DUS, 24, 84000, '8990000600024']]); // hemat vs 24 x 4.000
    await setPackages(p.air.by('1500 ml'), [[uom.DUS, 12, 78000]]);
    for (const s of p.keripik.skus) await setPackages(s, [[uom.DUS, 24, 336000]]);

    // ---------- harga vendor (vendor utama) ----------
    const prices = [];
    const addPrice = (v, sku, uomBeli, konversi, hargaBeli, extra = {}) => prices.push({
      vendor: v._id, produk: sku.produk, sku: sku._id, uomBeli: uomBeli._id, konversi, hargaBeli, isPreferred: true, ...extra, ...by,
    });
    p.kaos.skus.forEach((s) => addPrice(vendor.sandang, s, uom.BOX, 12, s.hargaJual > 70000 ? 480000 : 420000, { minOrder: 1 })); // 35.000 / 40.000 per pcs
    p.keripik.skus.forEach((s) => addPrice(vendor.pangan, s, uom.DUS, 24, 216000, { minOrder: 2 }));                             // 9.000 / pcs
    addPrice(vendor.pangan, p.air.by('600 ml'), uom.DUS, 24, 60000);                                                               // 2.500 / pcs
    addPrice(vendor.pangan, p.air.by('1500 ml'), uom.DUS, 12, 54000);                                                              // 4.500 / pcs
    addPrice(vendor.elektro, p.kipas.skus[0], uom.UNIT, 1, 180000);
    addPrice(vendor.pangan, p.beras.skus[0], uom.SAK, 25, 312500);                                                                 // 12.500 / kg
    addPrice(vendor.pangan, p.gula.skus[0], uom.SAK, 50, 750000);                                                                  // 15.000 / kg
    const vps = await VendorPrice.insertMany(prices);
    await log('vendorPrice', vps);
    const costOf = new Map(vps.map((v) => [String(v.sku), round2(v.hargaBeli / v.konversi)]));

    // ---------- stok awal (Saldo Awal, POSTED) ----------
    const opening = async (g, lines) => {
      const now = new Date(Date.now() - 7 * DAY);
      const doc = await StockAdjustment.create({
        no: await nextDocNo('ADJ', now), type: 'ADJUSTMENT', gudang: g._id, date: now, reason: 'OPENING',
        note: 'Saldo awal (data demo)', status: 'POSTED', postedBy: admin._id, postedDate: now, ...by,
        lines: lines.map((l) => ({ sku: l.sku._id, produk: l.sku.produk, qtySystem: 0, qtyChange: l.qty, unitCost: costOf.get(String(l.sku._id)) })),
      });
      await applyMovements(req, lines.map((l) => ({
        sku: l.sku._id, gudang: g._id, qty: l.qty, unitCost: costOf.get(String(l.sku._id)), type: 'OPENING', reason: 'OPENING', note: doc.note,
      })), { refType: 'StockAdjustment', refId: doc._id, refNo: doc.no });
      await log('stockAdjustment', [doc]);
    };
    const kaosQty = [24, 6, 18, 30, 12, 4, 15, 9, 20, 10, 8, 3]; // beberapa di bawah minimum -> reorder alert
    await opening(gudang.main, [
      ...p.kaos.skus.map((s, i) => ({ sku: s, qty: kaosQty[i % kaosQty.length] })),
      ...p.keripik.skus.map((s) => ({ sku: s, qty: 120 })),
      ...p.air.skus.map((s) => ({ sku: s, qty: 96 })),
      { sku: p.kipas.skus[0], qty: 8 },
      { sku: p.beras.skus[0], qty: 250.5 },
      { sku: p.gula.skus[0], qty: 100 },
    ]);
    await opening(gudang.sby, [
      ...p.kaos.skus.slice(0, 4).map((s) => ({ sku: s, qty: 10 })),
      ...p.keripik.skus.map((s) => ({ sku: s, qty: 48 })),
      ...p.air.skus.map((s) => ({ sku: s, qty: 48 })),
      { sku: p.beras.skus[0], qty: 75 },
      { sku: p.gula.skus[0], qty: 50 },
    ]);

    // ---------- batas reorder ----------
    const rules = await ReorderRule.insertMany([
      ...p.kaos.skus.map((s) => ({ sku: s._id, produk: s.produk, gudang: gudang.main._id, minQty: 10, maxQty: 40, ...by })),
      { sku: p.kipas.skus[0]._id, produk: p.kipas.produk._id, gudang: gudang.main._id, minQty: 10, maxQty: 30, ...by },
      ...p.keripik.skus.map((s) => ({ sku: s._id, produk: s.produk, gudang: gudang.sby._id, minQty: 48, maxQty: 144, ...by })),
    ]);
    await log('reorderRule', rules);

    // ---------- price list & customer ----------
    const grosir = await create(PriceList, 'priceList', {
      code: 'GROSIR', name: 'Grosir', deskripsi: 'Harga reseller / pembelian partai (data demo)',
      items: [...p.kaos.skus, ...p.keripik.skus, ...p.air.skus].map((s) => ({ sku: s._id, produk: s.produk, price: round2(s.hargaJual * 0.9) })),
    });
    const customer = {
      walkIn: await Customer.findOne({ isWalkIn: true }),
      maju: await create(Customer, 'customer', { code: 'CUST00001', name: 'CV Maju Jaya (Demo)', phone: '0813-0000-1001', address: 'Jl. Niaga No. 8', provinsi: 'DKI Jakarta', kota: 'Jakarta Barat', kecamatan: 'Tambora', kodePos: '11220', latitude: -6.1450123, longitude: 106.8058456, npwp: '01.234.567.8-901.000', termDays: 30, priceList: grosir._id }),
      sinar: await create(Customer, 'customer', { code: 'CUST00002', name: 'Toko Sinar Abadi (Demo)', phone: '0813-0000-1002', address: 'Jl. Pahlawan No. 3', provinsi: 'Jawa Timur', kota: 'Surabaya', kecamatan: 'Bubutan', kodePos: '60174', termDays: 14, creditLimit: 25000000 }),
      budi: await create(Customer, 'customer', { code: 'CUST00003', name: 'Budi Santoso (Demo)', phone: '0813-0000-1003' }),
    };
    if (!customer.walkIn) throw new Error('Customer walk-in belum ada. Jalankan npm run init.');

    // ---------- user per role ----------
    const users = [];
    const outletByCode = { 'TOKO-JKT': outlet.jkt._id, 'TOKO-SBY': outlet.sby._id };
    const gudangByCode = { MAIN: gudang.main._id, SBY: gudang.sby._id };
    for (const u of DEMO_USERS) {
      const template = ROLE_TEMPLATES.find((t) => t.key === u.role);
      users.push(await User.create({
        name: u.name, email: u.email, password, isActive: true,
        role: roleByName.get(template.name)._id,
        ...(u.gudangs ? { allGudang: false, gudangs: u.gudangs.map((c) => gudangByCode[c]) } : {}),
        outlets: (u.outlets || []).map((c) => outletByCode[c]),
        ...(pinHash && u.role === 'storeSupervisor' ? { posPinHash: pinHash, hasPosPin: true } : {}),
        ...by,
      }));
    }
    await log('user', users);
    const kasirJkt = users.find((u) => u.email === 'kasir.jkt@demo.local');

    // ---------- transaksi contoh ----------
    // PO terbuka yang terlambat (kipas: status reorder "On order")
    const poLine = { sku: p.kipas.skus[0]._id, produk: p.kipas.produk._id, uomBeli: uom.UNIT._id, konversi: 1, qty: 10, hargaBeli: 180000, diskonPersen: 0 };
    poLine.subtotal = lineSubtotal(poLine);
    const po = await PurchaseOrder.create({
      no: await nextDocNo('PO'), vendor: vendor.elektro._id, gudang: gudang.main._id,
      date: new Date(Date.now() - 5 * DAY), expectedDate: new Date(Date.now() - 1 * DAY),
      status: 'OPEN', isPKP: settings['tax.isPKP'] !== false, taxRate: settings['tax.ppnRate'] ?? 11, lines: [poLine],
      ...poTotals([poLine], settings['tax.ppnRate'] ?? 11),
      note: 'Data demo', issuedBy: admin._id, issuedDate: new Date(Date.now() - 5 * DAY), ...by,
    });
    await log('purchaseOrder', [po]);

    // draft adjustment menunggu posting
    await create(StockAdjustment, 'stockAdjustment', {
      no: await nextDocNo('ADJ'), type: 'ADJUSTMENT', gudang: gudang.main._id, date: new Date(), reason: 'DAMAGED',
      note: 'Kemasan sobek (contoh draft)', status: 'DRAFT',
      lines: [{ sku: p.keripik.skus[0]._id, produk: p.keripik.produk._id, qtyChange: -3 }],
    });

    // penjualan POSTED (stok keluar + HPP); harga dari price list customer / harga jual
    const priceFor = (cust, sku) => {
      const item = cust.priceList && String(cust.priceList) === String(grosir._id) ? grosir.items.find((i) => String(i.sku) === String(sku._id)) : null;
      return item ? item.price : sku.hargaJual;
    };
    const makeSale = async ({ cust, gudangId, items, priceIncludesTax, prefix = 'INV', extra = {}, date = new Date(), dueDays = cust.termDays || 0 }) => {
      const lines = items.map(({ sku, qty, diskonPersen = 0 }) => {
        const l = { sku: sku._id, produk: sku.produk, qty, hargaJual: priceFor(cust, sku), diskonPersen, unitCost: null };
        l.subtotal = salesLineSubtotal(l);
        return l;
      });
      const totals = salesTotals(lines, { taxRate, priceIncludesTax });
      const doc = new SalesInvoice({
        no: await nextDocNo(prefix, date), customer: cust._id, gudang: gudangId, date, status: 'DRAFT',
        dueDate: new Date(new Date(date).setHours(0, 0, 0, 0) + dueDays * DAY),
        taxRate, priceIncludesTax, lines, ...totals, ...by, ...extra,
      });
      const movements = await applyMovements(req, lines.map((l) => ({ sku: l.sku, gudang: gudangId, qty: -l.qty, type: 'SALE' })),
        { refType: 'SalesInvoice', refId: doc._id, refNo: doc.no });
      const cost = new Map(movements.map((m) => [String(m.sku), m.unitCost ?? null]));
      doc.lines.forEach((l) => { l.unitCost = cost.get(String(l.sku)) ?? null; });
      doc.cogs = round2(doc.lines.reduce((s, l) => s + l.qty * (l.unitCost || 0), 0));
      Object.assign(doc, { status: 'POSTED', postedBy: admin._id, postedDate: date, returnedAmount: 0, paidAmount: extra.paidAmount || 0 });
      doc.paymentStatus = invoiceBalance(doc).paymentStatus;
      await doc.save();
      await log('salesInvoice', [doc]);
      return doc;
    };

    // invoice kredit ke CV Maju Jaya (price list Grosir, termin 30 hari, belum dibayar)
    const inv = await makeSale({
      cust: customer.maju, gudangId: gudang.main._id, priceIncludesTax: settings['sales.priceIncludesTax'] === true,
      items: [{ sku: p.kaos.by('Hitam', 'M'), qty: 6 }, { sku: p.keripik.by('Original'), qty: 24 }],
    });

    // sales order Toko Sinar Abadi (dikirim, ongkir): 1 surat jalan sudah keluar, belum ditagih
    const soItems = [{ sku: p.keripik.by('Original'), qty: 40 }, { sku: p.air.by('600 ml'), qty: 48 }];
    const soLines = soItems.map(({ sku, qty }) => {
      const l = { sku: sku._id, produk: sku.produk, qty, hargaJual: priceFor(customer.sinar, sku), diskonPersen: 0, qtyDelivered: 0 };
      l.subtotal = salesLineSubtotal(l);
      return l;
    });
    const soPit = settings['sales.priceIncludesTax'] === true;
    const so = new SalesOrder({
      no: await nextDocNo('SO'), customer: customer.sinar._id, gudang: gudang.main._id, date: new Date(Date.now() - 2 * DAY),
      requestedDate: new Date(Date.now() + 2 * DAY), customerPoNo: 'PO-SA-0099', deliveryMethod: 'DELIVERY',
      shipTo: { name: 'Toko Sinar Abadi', phone: '0813-0000-1002', alamat: 'Jl. Pahlawan No. 3', provinsi: 'Jawa Timur', kota: 'Surabaya', kecamatan: 'Bubutan', kodePos: '60174' },
      status: 'OPEN', taxRate, priceIncludesTax: soPit, lines: soLines,
      ...salesTotals(soLines, { taxRate, priceIncludesTax: soPit, shippingCharge: 25000 }),
      note: 'Data demo', confirmedBy: admin._id, confirmedDate: new Date(Date.now() - 2 * DAY), ...by,
    });
    await so.save();
    const dlvLines = [{ sku: soLines[0].sku, produk: soLines[0].produk, qty: 20 }];
    const dlv = new DeliveryOrder({
      no: await nextDocNo('DO'), salesOrder: so._id, customer: so.customer, gudang: so.gudang, date: new Date(Date.now() - DAY),
      deliveryMethod: 'DELIVERY', shipTo: so.shipTo.toObject(), vehicleNo: 'B 9123 XY', driverName: 'Sopir Demo',
      status: 'DRAFT', lines: dlvLines, ...by,
    });
    const dlvMoves = await applyMovements(req, dlvLines.map((l) => ({ sku: l.sku, gudang: so.gudang, qty: -l.qty, type: 'SALE', note: so.no })),
      { refType: 'DeliveryOrder', refId: dlv._id, refNo: dlv.no });
    dlv.lines.forEach((l) => { l.unitCost = dlvMoves.find((m) => String(m.sku) === String(l.sku))?.unitCost ?? null; });
    Object.assign(dlv, { status: 'POSTED', postedBy: admin._id, postedDate: new Date(Date.now() - DAY) });
    await dlv.save();
    so.lines[0].qtyDelivered = 20;
    so.status = 'PARTIAL';
    await so.save();
    await log('salesOrder', [so]);
    await log('deliveryOrder', [dlv]);

    // penawaran harga terkirim ke calon pembeli (walk-in), berlaku 14 hari
    const quoLines = [{ sku: p.keripik.by('Original'), qty: 100 }].map(({ sku, qty }) => {
      const l = { sku: sku._id, produk: sku.produk, qty, hargaJual: sku.hargaJual, diskonPersen: 5 };
      l.subtotal = salesLineSubtotal(l);
      return l;
    });
    const quo = await Quotation.create({
      no: await nextDocNo('QUO'), customer: customer.walkIn._id, prospectName: 'Kantin Sekolah Harapan (Demo)', prospectContact: '0813-0000-1099',
      gudang: gudang.main._id, date: new Date(), validUntil: new Date(Date.now() + 14 * DAY), deliveryMethod: 'PICKUP',
      status: 'SENT', taxRate, priceIncludesTax: soPit, lines: quoLines, ...salesTotals(quoLines, { taxRate, priceIncludesTax: soPit }),
      terms: 'Harga berlaku untuk pengambilan sekaligus.', sentBy: admin._id, sentDate: new Date(), ...by,
    });
    await log('quotation', [quo]);

    // shift POS tertutup di TOKO-JKT: 2 penjualan (tunai & QRIS)
    const openedAt = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const shift = await PosShift.create({
      no: await nextDocNo('SHF'), outlet: outlet.jkt._id, gudang: gudang.main._id, cashier: kasirJkt._id,
      status: 'OPEN', openedAt, openingCash: 200000, createdBy: kasirJkt._id,
    });
    const posSale = async (items, method, tendered) => {
      const lines = items.map(({ sku, qty }) => ({ sku, qty }));
      const preview = salesTotals(lines.map(({ sku, qty }) => ({ qty, hargaJual: sku.hargaJual, subtotal: salesLineSubtotal({ qty, hargaJual: sku.hargaJual }) })), { taxRate, priceIncludesTax: true });
      const cash = method === 'CASH';
      const doc = await makeSale({
        cust: customer.walkIn, gudangId: gudang.main._id, priceIncludesTax: true, prefix: 'POS', items, dueDays: 0,
        extra: { source: 'POS', outlet: outlet.jkt._id, shift: shift._id, cashTendered: cash ? tendered : null, change: cash ? round2(tendered - preview.total) : null, paidAmount: preview.total, createdBy: kasirJkt._id },
      });
      const pay = await SalesPayment.create({
        no: await nextDocNo('PAY'), type: 'PAYMENT', salesInvoice: doc._id, customer: customer.walkIn._id, gudang: gudang.main._id,
        shift: shift._id, date: new Date(), method, amount: doc.total, reference: cash ? '' : 'QR-DEMO-001', createdBy: kasirJkt._id,
      });
      await log('salesPayment', [pay]);
      return doc;
    };
    const s1 = await posSale([{ sku: p.air.by('600 ml'), qty: 3 }, { sku: p.keripik.by('Pedas'), qty: 2 }], 'CASH', 50000);
    const s2 = await posSale([{ sku: p.kaos.by('Putih', 'L'), qty: 1 }], 'QRIS');
    const cashSales = s1.total;
    shift.cashMoves.push({ type: 'OUT', amount: 20000, reason: 'Beli galon (contoh)', by: kasirJkt._id, date: new Date(openedAt.getTime() + 60 * 60 * 1000) });
    const expected = round2(200000 + cashSales - 20000);
    Object.assign(shift, {
      status: 'CLOSED', closedAt: new Date(Date.now() - 30 * 60 * 1000), closingCash: expected, expectedCash: expected, difference: 0,
      salesCount: 2, salesTotal: round2(s1.total + s2.total),
    });
    await shift.save();
    await log('posShift', [shift]);

    return {
      skus: Object.values(p).reduce((n, x) => n + x.skus.length, 0),
      users: users.length,
      po: po.no,
      invoice: inv.no,
      so: so.no,
      dlv: dlv.no,
      shift: shift.no,
      uoms: uomDefs.length,
    };
  });

  console.log(`[+] 2 gudang (MAIN, SBY), 2 outlet (TOKO-JKT, TOKO-SBY), ${summary.uoms} UoM, 4 varian, 4 kategori, 3 vendor`);
  console.log(`[+] 6 produk, ${summary.skus} SKU (harga jual, barcode, harga vendor), stok awal ber-HPP di 2 gudang, batas reorder`);
  console.log('[+] Price list GROSIR, 3 customer (+ walk-in)');
  console.log(`[+] Transaksi: ${summary.po} (terlambat), 1 draft adjustment, ${summary.invoice} (kredit, belum dibayar), ${summary.so} + surat jalan ${summary.dlv} (belum ditagih), shift ${summary.shift} (2 penjualan POS)`);
  console.log(`[+] ${summary.users} user demo (password sama, dari --password):`);
  for (const u of DEMO_USERS) {
    const t = ROLE_TEMPLATES.find((x) => x.key === u.role);
    const scope = [u.gudangs ? `gudang ${u.gudangs.join(', ')}` : '', u.outlets ? `outlet ${u.outlets.join(', ')}` : ''].filter(Boolean).join('; ');
    console.log(`    ${u.email.padEnd(24)} ${t.name}${scope ? ` (${scope})` : ''}`);
  }
  if (pin) console.log('[+] PIN POS untuk Store Supervisor (spv.toko@demo.local) diambil dari --pin');
  console.log('\nSelesai.');
}

main()
  .catch((err) => {
    console.error(`\n[!] ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
