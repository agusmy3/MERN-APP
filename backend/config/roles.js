/**
 * Role standar untuk database baru (`npm run init`). Super Admin (isSystem) otomatis semua izin.
 * Izin: { resource: [actions] } dari config/permissions.js; 'view' ditambahkan otomatis
 * (normalizePermissions). Setelah init, role bisa diubah lewat menu Role.
 *
 * Prinsip:
 * - Data biaya (HPP, harga beli, nilai persediaan = vendorPrice:view) hanya untuk Owner,
 *   Warehouse Supervisor, Purchasing, Finance.
 * - Pembuat draft dokumen stok dipisah dari pemosting (Warehouse Staff: draft, Supervisor: post).
 */
const { RESOURCES } = require('./permissions');

const ALL = ['view', 'create', 'update', 'delete'];
const DOC = ['view', 'create', 'update', 'delete', 'post'];

// Owner: lihat semua menu (termasuk biaya & laporan), tanpa mengubah data
const viewAll = Object.fromEntries(RESOURCES.map((r) => [r.key, ['view']]));

const ROLE_TEMPLATES = [
  {
    key: 'owner',
    name: 'Owner / Manager',
    deskripsi: 'Melihat semua data, laporan & nilai biaya; tidak mengubah data',
    permissions: viewAll,
  },
  {
    key: 'masterData',
    name: 'Admin Master Data',
    deskripsi: 'Kelola kategori, produk & SKU, UoM, varian, vendor, customer, price list, gudang, outlet',
    permissions: {
      kategori: ALL, produk: ALL, uom: ALL, variant: ALL, vendor: ALL, customer: ALL,
      priceList: ALL, gudang: ALL, outlet: ALL,
    },
  },
  {
    key: 'warehouseStaff',
    name: 'Warehouse Staff',
    deskripsi: 'Draft stock adjustment / opname, kirim & terima transfer, kartu stok, lihat reorder',
    permissions: {
      produk: ['view'], gudang: ['view'],
      stockAdjustment: ['view', 'create', 'update', 'delete'],
      stockTransfer: DOC,
      stockMovement: ['view'],
      reorder: ['view'],
    },
  },
  {
    key: 'warehouseSupervisor',
    name: 'Warehouse Supervisor',
    deskripsi: 'Warehouse Staff + posting dokumen stok, cost revaluation, nilai persediaan, atur reorder',
    permissions: {
      produk: ['view'], gudang: ['view'],
      stockAdjustment: DOC,
      stockTransfer: DOC,
      stockMovement: ['view'],
      reorder: ['view', 'update'],
      costRevaluation: DOC,
      vendorPrice: ['view'],
    },
  },
  {
    key: 'purchasing',
    name: 'Purchasing',
    deskripsi: 'Purchase order, penerimaan barang, vendor & harga beli, reorder',
    permissions: {
      produk: ['view'], gudang: ['view'],
      vendor: ALL, vendorPrice: ALL,
      purchaseOrder: ALL,
      goodsReceipt: DOC,
      reorder: ['view', 'update'],
      stockMovement: ['view'],
    },
  },
  {
    key: 'salesAdmin',
    name: 'Sales Admin',
    deskripsi: 'Sales invoice, retur penjualan, customer; lihat price list',
    permissions: {
      produk: ['view'],
      customer: ALL,
      priceList: ['view'],
      salesInvoice: DOC,
      salesReturn: DOC,
    },
  },
  {
    key: 'finance',
    name: 'Finance',
    deskripsi: 'Pembayaran & refund, laporan penjualan & umur piutang, nilai persediaan',
    permissions: {
      customer: ['view'],
      salesInvoice: ['view'],
      salesReturn: ['view'],
      salesPayment: ['view', 'create', 'update'],
      salesReport: ['view'],
      vendorPrice: ['view'],
    },
  },
  {
    key: 'cashier',
    name: 'Cashier',
    deskripsi: 'Layar kasir POS (outlet ditugaskan lewat menu User)',
    permissions: { pos: ['view', 'create'] },
  },
  {
    key: 'storeSupervisor',
    name: 'Store Supervisor',
    deskripsi: 'Cashier + menyetujui void & retur di kasir (PIN), shift kasir (lihat & tutup), retur penjualan, laporan',
    permissions: {
      pos: ['view', 'create', 'post'],
      posShift: ['view', 'update'],
      customer: ['view', 'create', 'update'],
      salesInvoice: ['view'],
      salesReturn: DOC,
      salesReport: ['view'],
    },
  },
];

/** { resource: actions } -> [{ resource, actions }] */
const toPermissionList = (map) => Object.entries(map).map(([resource, actions]) => ({ resource, actions }));

module.exports = { ROLE_TEMPLATES, toPermissionList };
