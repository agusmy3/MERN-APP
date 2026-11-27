/**
 * Helper peta (Leaflet + OpenStreetMap). Komponen: components/map/MapPickerModal.jsx.
 * Tile OSM publik: wajib atribusi; cocok untuk trafik kecil (aplikasi internal). Ganti URL di sini bila pindah penyedia.
 */
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors';
export const TILE_MAX_ZOOM = 19;

/** Tampilan awal tanpa titik & wilayah: seluruh Indonesia */
export const INDONESIA_VIEW = { lat: -2.5, lng: 118, zoom: 5 };

/** Titik sah dari nilai form (string / number) -> { lat, lng } atau null */
export const parsePoint = (lat, lng) => {
  if (lat === '' || lat === null || lat === undefined || lng === '' || lng === null || lng === undefined) return null;
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < -90 || a > 90 || b < -180 || b > 180) return null;
  return { lat: a, lng: b };
};

/** 6 desimal (~10 cm) — cukup untuk titik lokasi, backend menyimpan maks. 7 */
export const roundCoord = (v) => Math.round(Number(v) * 1e6) / 1e6;

export const formatPoint = (p) => (p ? `${roundCoord(p.lat).toFixed(6)}, ${roundCoord(p.lng).toFixed(6)}` : '');

/**
 * Tampilan awal pemilih titik: titik yang sudah ada (zoom dekat), lalu pusat wilayah dari master
 * (`center` GET /api/region/:kode: level 1 provinsi, 2 kab/kota), lalu seluruh Indonesia.
 */
export const pickerView = (point, center) => {
  if (point) return { lat: point.lat, lng: point.lng, zoom: 17 };
  if (center && Number.isFinite(center.lat) && Number.isFinite(center.lng)) {
    return { lat: center.lat, lng: center.lng, zoom: center.level === 1 ? 8 : 13 };
  }
  return INDONESIA_VIEW;
};

/** Pesan untuk kegagalan "Lokasi saya" (GeolocationPositionError.code) */
export const geoErrorMessage = (code) => ({
  1: 'Izin lokasi ditolak browser. Izinkan akses lokasi untuk situs ini, atau klik titik di peta.',
  2: 'Lokasi perangkat tidak tersedia. Klik titik di peta.',
  3: 'Mengambil lokasi terlalu lama. Coba lagi, atau klik titik di peta.',
}[code] || 'Gagal mengambil lokasi. Klik titik di peta.');

// ---------- halaman Peta & widget dashboard ----------

/** Lapisan peta: urutan = urutan di panel & legenda; warna marker = CSS .map-marker--<type> di index.css */
export const LAYER_META = {
  outlet: { label: 'Outlet', icon: 'fa-store', path: '/outlet' },
  gudang: { label: 'Warehouse', icon: 'fa-warehouse', path: '/gudang' },
  vendor: { label: 'Vendor', icon: 'fa-truck-field', path: '/vendor' },
  customer: { label: 'Customer', icon: 'fa-user', path: '/customer' },
};
export const LAYER_ORDER = ['outlet', 'gudang', 'vendor', 'customer'];

/** { layers: { type: { points, missing } } } -> titik datar [{ key, type, ...p }] */
export const flattenPoints = (layers) => LAYER_ORDER.flatMap((type) => (layers?.[type]?.points || [])
  .map((p) => ({ ...p, type, key: `${type}:${p.id}` })));

/** Saring titik di sisi klien: lapisan aktif, wilayah (awalan kode), cari nama/kode, overdue, nonaktif */
export const filterPoints = (points, {
  visible = LAYER_ORDER, region = '', search = '', overdueOnly = false, showInactive = false,
} = {}) => {
  const q = search.trim().toLowerCase();
  return points.filter((p) => {
    if (!visible.includes(p.type)) return false;
    if (!showInactive && p.isActive === false) return false;
    if (region && !(p.regionCode === region || p.regionCode?.startsWith(`${region}.`))) return false;
    if (overdueOnly && p.type === 'customer' && !p.overdue) return false;
    if (q && !`${p.name} ${p.code || ''} ${p.place || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
};

/** Halaman master record tsb, dicari lewat ?search= (kode, atau nama untuk vendor) */
export const detailLink = (p) => `${LAYER_META[p.type].path}?search=${encodeURIComponent(p.type === 'vendor' ? p.name : (p.code || p.name))}`;

/** Batas peta yang memuat semua titik -> [[minLat, minLng], [maxLat, maxLng]] atau null */
export const pointsBounds = (points) => {
  if (!points.length) return null;
  let [a, b, c, d] = [90, 180, -90, -180];
  points.forEach((p) => { a = Math.min(a, p.lat); b = Math.min(b, p.lng); c = Math.max(c, p.lat); d = Math.max(d, p.lng); });
  return [[a, b], [c, d]];
};
