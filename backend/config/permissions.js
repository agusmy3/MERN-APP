/**
 * Registri izin (RBAC) — sumber kebenaran daftar resource & action.
 *
 * - Izin disimpan di Role.permissions: [{ resource: 'produk', actions: ['view', 'create'] }]
 * - 'view' = akses menu (lihat tabel, search, detail). Action lain hanya sah jika 'view' juga ada.
 * - Role dengan isSystem = true (Super Admin) otomatis punya semua izin.
 * - Menambah resource baru: tambahkan di RESOURCES, lalu pasang authorize('<key>', ...) di route-nya.
 *   Role lama otomatis TIDAK punya akses ke resource baru (aman secara default).
 */

const ACTIONS = ['view', 'create', 'update', 'delete'];

// `group` hanya untuk pengelompokan di matriks halaman Role.
// `actions` (opsional) membatasi action yang berlaku, mis. log yang hanya bisa dilihat.
const RESOURCES = [
  { key: 'kategori', label: 'Category', group: 'Master Data' },
  { key: 'produk', label: 'Product', group: 'Master Data' },
  { key: 'uom', label: 'Unit of Measure', group: 'Master Data' },
  { key: 'variant', label: 'Variant', group: 'Master Data' },
  { key: 'vendor', label: 'Vendor', group: 'Master Data' },
  // harga beli = data sensitif (margin), dipisah dari izin produk
  { key: 'vendorPrice', label: 'Vendor Price', group: 'Master Data' },
  { key: 'menu', label: 'Menu', group: 'Settings' },
  { key: 'role', label: 'Role', group: 'Settings' },
  { key: 'user', label: 'User', group: 'Settings' },
  // halaman Audit Log global (histori per record mengikuti izin view resource-nya)
  { key: 'auditLog', label: 'Audit Log', group: 'Settings', actions: ['view'] },
];

const allowedActions = (key) => RESOURCES.find((r) => r.key === key)?.actions || ACTIONS;

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
      .map((p) => [p.resource, ACTIONS.filter((a) => p.actions.includes(a))])
  );
};

/** `user.role` harus sudah di-populate (dilakukan oleh middleware protect). */
const hasPermission = (user, resource, action) => {
  const role = user?.role;
  if (!role) return false;
  if (role.isSystem) return true;
  const entry = (role.permissions || []).find((p) => p.resource === resource);
  if (!entry) return false;
  // action selain view hanya sah jika view juga diberikan
  return entry.actions.includes(action) && entry.actions.includes('view');
};

module.exports = {
  ACTIONS,
  RESOURCES,
  RESOURCE_KEYS,
  isValidResource,
  getResourceLabel,
  normalizePermissions,
  getEffectivePermissions,
  hasPermission,
};
