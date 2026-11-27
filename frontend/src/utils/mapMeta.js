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
