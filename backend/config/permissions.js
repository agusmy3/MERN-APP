/**
 * Registri izin (RBAC) — sumber kebenaran daftar resource & action.
 *
 * - Izin disimpan di Role.permissions: [{ resource: 'produk', actions: ['view', 'create'] }]
 * - 'view' = akses menu (lihat tabel, search, detail). Action lain hanya sah jika 'view' juga ada.
 * - Role dengan isSystem = true (Super Admin) otomatis punya semua izin.
 * - Menambah resource baru: tambahkan di RESOURCES, lalu pasang authorize('<key>', ...) di route-nya.
 *   Role lama otomatis TIDAK punya akses ke resource baru (aman secara default).
 */

// Semua action yang dikenal. 'post' (posting/pembatalan dokumen yang mengubah stok) dan 'approve'
// (menyetujui pengecualian, mis. konfirmasi SO melewati batas kredit) hanya berlaku untuk resource
// yang mendeklarasikannya di `actions`.
const ACTIONS = ['view', 'create', 'update', 'delete', 'post', 'approve'];
// action default untuk resource yang tidak menulis `actions`
const DEFAULT_ACTIONS = ['view', 'create', 'update', 'delete'];

// `group` hanya untuk pengelompokan di matriks halaman Role.
// `actions` (opsional) membatasi action yang berlaku, mis. log yang hanya bisa dilihat.
const RESOURCES = [
  // halaman Peta (lokasi outlet, gudang, vendor & customer): tiap lapisan & angka ringkasan tetap butuh izin view
  // resource-nya masing-masing (mis. customer:view untuk titik customer)
  { key: 'map', label: 'Map', group: 'Dashboard', actions: ['view'] },
  { key: 'kategori', label: 'Category', group: 'Master Data' },
  { key: 'produk', label: 'Product', group: 'Master Data' },
  { key: 'uom', label: 'Unit of Measure', group: 'Master Data' },
  { key: 'variant', label: 'Variant', group: 'Master Data' },
  { key: 'vendor', label: 'Vendor', group: 'Master Data' },
  // harga beli = data sensitif (margin), dipisah dari izin produk
  { key: 'vendorPrice', label: 'Vendor Price', group: 'Master Data' },
  { key: 'gudang', label: 'Warehouse', group: 'Master Data' },
  { key: 'customer', label: 'Customer', group: 'Master Data' },
  // outlet / toko POS (stok dari 1 gudang)
  { key: 'outlet', label: 'Outlet', group: 'Master Data' },
  // dokumen stok: create/update/delete = draft; post = posting & pembatalan (mengubah stok)
  { key: 'stockAdjustment', label: 'Stock Adjustment', group: 'Inventory', actions: ['view', 'create', 'update', 'delete', 'post'] },
  // transfer antar gudang: create/update/delete = draft; post = kirim, terima & batalkan.
  // Kirim/batal butuh akses gudang asal, terima butuh akses gudang tujuan (User.gudangs)
  { key: 'stockTransfer', label: 'Stock Transfer', group: 'Inventory', actions: ['view', 'create', 'update', 'delete', 'post'] },
  // kartu stok & laporan pergerakan (baca saja; stok hanya berubah lewat dokumen)
  { key: 'stockMovement', label: 'Stock Movement', group: 'Inventory', actions: ['view'] },
  // reorder alert: view = daftar & badge; update = atur min/max per SKU + gudang
  { key: 'reorder', label: 'Reorder', group: 'Inventory', actions: ['view', 'update'] },
  // revaluasi HPP (data biaya): create/update/delete = draft; post = posting & pembatalan
  { key: 'costRevaluation', label: 'Cost Revaluation', group: 'Inventory', actions: ['view', 'create', 'update', 'delete', 'post'] },
  // PO: create = buat draft / terbitkan; update = ubah draft, close & cancel PO; delete = hapus draft
  { key: 'purchaseOrder', label: 'Purchase Order', group: 'Purchasing' },
  // Penerimaan barang: create/update/delete = draft; post = posting & pembatalan (mengubah stok & HPP)
  { key: 'goodsReceipt', label: 'Goods Receipt', group: 'Purchasing', actions: ['view', 'create', 'update', 'delete', 'post'] },
  // tagihan vendor (hutang): create = buat tagihan dari GR (langsung berlaku); update = batalkan. Butuh juga vendorPrice:view
  { key: 'purchaseInvoice', label: 'Vendor Bill', group: 'Purchasing', actions: ['view', 'create', 'update'] },
  // pembayaran ke vendor / refund dari vendor: create = catat; update = batalkan. Butuh juga vendorPrice:view
  { key: 'vendorPayment', label: 'Vendor Payment', group: 'Purchasing', actions: ['view', 'create', 'update'] },
  // retur ke vendor: create/update/delete = draft; post = posting & pembatalan (stok keluar / kembali)
  { key: 'purchaseReturn', label: 'Purchase Return', group: 'Purchasing', actions: ['view', 'create', 'update', 'delete', 'post'] },
  // Quotation / penawaran harga: create = draft; update = ubah draft, kirim, revisi, tolak, konversi ke SO
  // (konversi butuh juga salesOrder:create); delete = hapus draft
  { key: 'quotation', label: 'Quotation', group: 'Sales' },
  // Sales Order (tidak mengubah stok): create = buat draft / konfirmasi; update = ubah draft, konfirmasi,
  // cancel & close; delete = hapus draft; approve = konfirmasi melewati batas kredit / invoice lewat jatuh tempo
  { key: 'salesOrder', label: 'Sales Order', group: 'Sales', actions: ['view', 'create', 'update', 'delete', 'approve'] },
  // Delivery Order / surat jalan: create/update/delete = draft; post = posting & pembatalan (stok keluar / kembali).
  // Buat invoice dari DO butuh juga salesInvoice create + post
  { key: 'deliveryOrder', label: 'Delivery Order', group: 'Sales', actions: ['view', 'create', 'update', 'delete', 'post'] },
  // penjualan langsung: create/update/delete = draft; post = posting & pembatalan (stok keluar / kembali).
  // HPP & laba kotor hanya untuk vendorPrice:view
  { key: 'salesInvoice', label: 'Sales Invoice', group: 'Sales', actions: ['view', 'create', 'update', 'delete', 'post'] },
  // retur atas invoice: create/update/delete = draft; post = posting & pembatalan (stok masuk, tagihan berkurang)
  { key: 'salesReturn', label: 'Sales Return', group: 'Sales', actions: ['view', 'create', 'update', 'delete', 'post'] },
  // pembayaran / refund invoice: create = catat (langsung berlaku); update = batalkan
  { key: 'salesPayment', label: 'Sales Payment', group: 'Sales', actions: ['view', 'create', 'update'] },
  // harga jual khusus per customer
  { key: 'priceList', label: 'Price List', group: 'Sales' },
  // laporan penjualan & umur piutang (baca saja; HPP & laba hanya untuk vendorPrice:view)
  { key: 'salesReport', label: 'Sales Report', group: 'Sales', actions: ['view'] },
  // layar kasir: view = buka layar; create = buka/tutup shift sendiri, kas masuk/keluar, transaksi
  // (outlet harus ditugaskan ke user lewat User.outlets)
  // post = menyetujui void / retur di layar kasir dengan PIN (supervisor toko; PIN diatur di form User)
  { key: 'pos', label: 'POS Cashier', group: 'POS', actions: ['view', 'create', 'post'] },
  // semua shift kasir: view = daftar & ringkasan; update = tutup shift kasir lain
  { key: 'posShift', label: 'POS Shift', group: 'POS', actions: ['view', 'update'] },
  { key: 'menu', label: 'Menu', group: 'Settings' },
  { key: 'role', label: 'Role', group: 'Settings' },
  { key: 'user', label: 'User', group: 'Settings' },
  // halaman Audit Log global (histori per record mengikuti izin view resource-nya)
  { key: 'auditLog', label: 'Audit Log', group: 'Settings', actions: ['view'] },
  // variabel global (mis. PKP & tarif PPN)
  { key: 'setting', label: 'System Settings', group: 'Settings', actions: ['view', 'update'] },
];

const allowedActions = (key) => RESOURCES.find((r) => r.key === key)?.actions || DEFAULT_ACTIONS;

/** Registri untuk frontend (matriks Role): setiap resource dengan daftar action yang berlaku. */
const getResourceRegistry = () => RESOURCES.map((r) => ({ ...r, actions: allowedActions(r.key) }));

const RESOURCE_KEYS = RESOURCES.map((r) => r.key);

const isValidResource = (key) => RESOURCE_KEYS.includes(key);

const getResourceLabel = (key) => RESOURCES.find((r) => r.key === key)?.label || key;

/**
 * Rapikan input izin dari client: buang resource/action yang tidak dikenal & duplikat,
 * tambahkan 'view' jika ada action lain, buang resource tanpa action. Urutan mengikuti registri.
 */
const normalizePermissions = (input) => {
  if (!Array.isArray(input)) return [];
  const byResource = new Map();

  for (const item of input) {
    if (!item || !isValidResource(item.resource) || !Array.isArray(item.actions)) continue;
    const actions = byResource.get(item.resource) || new Set();
    const allowed = allowedActions(item.resource);
    item.actions.filter((a) => allowed.includes(a)).forEach((a) => actions.add(a));
    byResource.set(item.resource, actions);
  }

  return RESOURCE_KEYS
    .filter((key) => byResource.get(key)?.size)
    .map((key) => {
      const actions = byResource.get(key);
      actions.add('view'); // create/update/delete selalu butuh view
      return { resource: key, actions: ACTIONS.filter((a) => actions.has(a)) };
    });
};

/**
 * Izin efektif untuk dikirim ke frontend: { produk: ['view', 'create'], ... }.
 * `role` = dokumen Role (sudah di-populate) atau null.
 */
const getEffectivePermissions = (role) => {
  if (!role) return {};
  if (role.isSystem) {
    return Object.fromEntries(RESOURCE_KEYS.map((key) => [key, [...allowedActions(key)]]));
  }
  // aturan sama dengan hasPermission: entri tanpa 'view' dianggap tidak memberi akses apa pun
  return Object.fromEntries(
    (role.permissions || [])
      .filter((p) => isValidResource(p.resource) && p.actions?.includes('view'))
      .map((p) => [p.resource, allowedActions(p.resource).filter((a) => p.actions.includes(a))])
  );
};

/** `user.role` harus sudah di-populate (dilakukan oleh middleware protect). */
const hasPermission = (user, resource, action) => {
  const role = user?.role;
  if (!role) return false;
  if (role.isSystem) return true;
  const entry = (role.permissions || []).find((p) => p.resource === resource);
  if (!entry || !allowedActions(resource).includes(action)) return false;
  // action selain view hanya sah jika view juga diberikan
  return entry.actions.includes(action) && entry.actions.includes('view');
};

module.exports = {
  ACTIONS,
  RESOURCES,
  RESOURCE_KEYS,
  allowedActions,
  getResourceRegistry,
  isValidResource,
  getResourceLabel,
  normalizePermissions,
  getEffectivePermissions,
  hasPermission,
};
