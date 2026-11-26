/**
 * Susunan menu sidebar STANDAR (sumber tunggal): dipakai `npm run init` (database baru) dan
 * `npm run menu:organize` (merapikan database lama). Grup = menu tanpa route; `order` grup dari sini,
 * urutan anak = urutan di daftar. `resource` = izin view yang dibutuhkan (config/permissions.js).
 */
const leaf = (component, menu, icon, resource, deskripsi) => ({ component, menu, icon, resource, deskripsi });

const MENU_TARGET = [
  { ...leaf('/', 'Dashboard', 'fa-solid fa-gauge', null, null), order: 1 },
  {
    group: 'Master Data', aliases: ['Master'], icon: 'fa-solid fa-database', order: 2,
    children: [
      leaf('/kategori', 'Category', 'fa-solid fa-tags', 'kategori', 'Kelola kategori produk'),
      leaf('/produk', 'Product', 'fa-solid fa-box', 'produk', 'Kelola produk, SKU & harga'),
      leaf('/variant', 'Variant', 'fa-solid fa-swatchbook', 'variant', 'Jenis varian & nilainya'),
      leaf('/uom', 'Unit of Measure', 'fa-solid fa-ruler', 'uom', 'Satuan produk'),
      leaf('/vendor', 'Vendor', 'fa-solid fa-building', 'vendor', 'Data vendor / supplier'),
      leaf('/customer', 'Customer', 'fa-solid fa-user-tag', 'customer', 'Data pelanggan'),
      leaf('/gudang', 'Warehouse', 'fa-solid fa-warehouse', 'gudang', 'Kelola gudang / lokasi penyimpanan stok'),
      leaf('/outlet', 'Outlet', 'fa-solid fa-store', 'outlet', 'Toko / outlet POS dan gudang sumber stoknya'),
    ],
  },
  {
    group: 'Inventory', aliases: [], icon: 'fa-solid fa-boxes-stacked', order: 3,
    children: [
      leaf('/stock-adjustment', 'Stock Adjustment', 'fa-solid fa-boxes-stacked', 'stockAdjustment', 'Penyesuaian stok & stock opname (draft, posting, pembatalan)'),
      leaf('/stock-transfer', 'Stock Transfer', 'fa-solid fa-truck-arrow-right', 'stockTransfer', 'Pindah stok antar gudang: kirim lalu terima'),
      leaf('/stock-movement', 'Stock Movement', 'fa-solid fa-right-left', 'stockMovement', 'Kartu stok: semua pergerakan stok per SKU dan gudang'),
      leaf('/reorder', 'Reorder', 'fa-solid fa-bell', 'reorder', 'SKU yang perlu dipesan ulang (stok <= minimum) & buat draft PO'),
      leaf('/stock-valuation', 'Stock Valuation', 'fa-solid fa-sack-dollar', 'vendorPrice', 'Nilai persediaan saat ini: stok x HPP rata-rata'),
      leaf('/cost-revaluation', 'Cost Revaluation', 'fa-solid fa-scale-balanced', 'costRevaluation', 'Isi / koreksi HPP SKU tanpa mengubah jumlah stok'),
    ],
  },
  {
    group: 'Purchasing', aliases: [], icon: 'fa-solid fa-cart-shopping', order: 4,
    children: [
      leaf('/purchase-order', 'Purchase Order', 'fa-solid fa-file-invoice', 'purchaseOrder', 'Pesanan pembelian ke vendor'),
      leaf('/goods-receipt', 'Goods Receipt', 'fa-solid fa-truck-ramp-box', 'goodsReceipt', 'Penerimaan barang dari PO: stok & HPP bertambah saat diposting'),
    ],
  },
  {
    group: 'Sales', aliases: [], icon: 'fa-solid fa-cash-register', order: 5,
    children: [
      leaf('/sales-order', 'Sales Order', 'fa-solid fa-file-signature', 'salesOrder', 'Pesanan customer: dikirim / diambil bertahap lewat surat jalan, lalu ditagih'),
      leaf('/delivery-order', 'Delivery Order', 'fa-solid fa-truck-fast', 'deliveryOrder', 'Surat jalan: stok keluar saat diposting, lalu dibuatkan invoice'),
      leaf('/sales-invoice', 'Sales Invoice', 'fa-solid fa-file-invoice-dollar', 'salesInvoice', 'Penjualan langsung: stok keluar & laba kotor saat diposting'),
      leaf('/sales-return', 'Sales Return', 'fa-solid fa-rotate-left', 'salesReturn', 'Retur atas invoice: stok masuk kembali, tagihan berkurang'),
      leaf('/sales-payment', 'Sales Payment', 'fa-solid fa-money-bill-wave', 'salesPayment', 'Pembayaran & refund invoice penjualan'),
      leaf('/price-list', 'Price List', 'fa-solid fa-tags', 'priceList', 'Harga jual khusus per customer'),
      leaf('/sales-report', 'Sales Report', 'fa-solid fa-chart-column', 'salesReport', 'Penjualan bersih per periode, customer & produk; umur piutang'),
    ],
  },
  {
    group: 'POS', aliases: [], icon: 'fa-solid fa-store', order: 6,
    children: [
      leaf('/pos', 'Cashier', 'fa-solid fa-cash-register', 'pos', 'Layar kasir: scan barang, bayar, cetak struk'),
      leaf('/pos-shift', 'POS Shift', 'fa-solid fa-clock', 'posShift', 'Shift kasir: modal, penjualan, kas & selisih'),
    ],
  },
  {
    group: 'Settings', aliases: ['General'], icon: 'fa-solid fa-gear', order: 9,
    children: [
      leaf('/users', 'User', 'fa-solid fa-users', 'user', 'Kelola akun pengguna dan role-nya'),
      leaf('/roles', 'Role', 'fa-solid fa-user-shield', 'role', 'Atur hak akses setiap role per menu dan operasi'),
      leaf('/menu', 'Menu', 'fa-solid fa-bars', 'menu', 'Struktur menu sidebar'),
      leaf('/settings', 'System Settings', 'fa-solid fa-sliders', 'setting', 'Variabel global aplikasi, mis. status PKP & tarif PPN'),
      leaf('/audit-log', 'Audit Log', 'fa-solid fa-clock-rotate-left', 'auditLog', 'Jejak perubahan data dan aktivitas login'),
    ],
  },
];

module.exports = { MENU_TARGET, leaf };
