/** Helper lokasi untuk form Customer & Vendor (komponen: components/RegionFields.jsx) */

// link peta (dibuka user di tab baru; tidak ada request otomatis ke layanan luar)
export const mapUrl = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;

export const EMPTY_REGION = { provinsi: '', kota: '', kecamatan: '', kodePos: '', latitude: '', longitude: '' };

/** Nilai form wilayah dari record (koordinat null -> '') */
export const regionFrom = (row) => ({
  provinsi: row?.provinsi || '',
  kota: row?.kota || '',
  kecamatan: row?.kecamatan || '',
  kodePos: row?.kodePos || '',
  latitude: row?.latitude === null || row?.latitude === undefined ? '' : String(row.latitude),
  longitude: row?.longitude === null || row?.longitude === undefined ? '' : String(row.longitude),
});

/** Validasi sisi klien (backend tetap memvalidasi): pesan error atau null */
export const regionError = (form) => {
  if (form.kodePos && !/^\d{5}$/.test(form.kodePos)) return 'Kode pos harus 5 digit.';
  if (!form.latitude !== !form.longitude) return 'Isi latitude dan longitude sekaligus, atau kosongkan keduanya.';
  return null;
};
