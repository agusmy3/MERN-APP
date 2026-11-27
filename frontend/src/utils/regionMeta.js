/**
 * Helper lokasi untuk form Customer, Vendor, Gudang, Outlet & alamat kirim SO (komponen: components/RegionFields.jsx).
 * Wilayah dipilih dari master (regionCode = kode terdalam yang dipilih); nama provinsi..kelurahan disalin dari master.
 */

// link peta (dibuka user di tab baru; tidak ada request otomatis ke layanan luar)
export const mapUrl = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;

export const REGION_LEVELS = [
  { field: 'provinsi', label: 'Province' },
  { field: 'kota', label: 'City / Regency' },
  { field: 'kecamatan', label: 'District' },
  { field: 'kelurahan', label: 'Village' },
];

export const EMPTY_REGION = {
  provinsi: '', kota: '', kecamatan: '', kelurahan: '', regionCode: '', kodePos: '', latitude: '', longitude: '',
};

/** Nilai form wilayah dari record (koordinat null -> '') */
export const regionFrom = (row) => ({
  provinsi: row?.provinsi || '',
  kota: row?.kota || '',
  kecamatan: row?.kecamatan || '',
  kelurahan: row?.kelurahan || '',
  regionCode: row?.regionCode || '',
  kodePos: row?.kodePos || '',
  latitude: row?.latitude === null || row?.latitude === undefined ? '' : String(row.latitude),
  longitude: row?.longitude === null || row?.longitude === undefined ? '' : String(row.longitude),
});

/** "32.73.02.1001" -> ["32", "32.73", "32.73.02", "32.73.02.1001"] */
export const regionChain = (code) => (code ? code.split('.').map((_, i, parts) => parts.slice(0, i + 1).join('.')) : []);

/**
 * Teks wilayah lama yang belum dipilih dari master: semua nama bila belum ada kode, atau nama di bawah tingkat
 * kode (hasil migrasi sebagian). -> [{ label, value }]
 */
export const legacyRegionText = (form) => {
  const depth = regionChain(form.regionCode).length;
  return REGION_LEVELS.slice(depth).filter((l) => form[l.field]).map((l) => ({ label: l.label, value: form[l.field] }));
};

/**
 * Form setelah memilih wilayah tingkat `level` (0 = provinsi). item null = kosongkan tingkat itu (kode kembali
 * ke tingkat di atasnya). Tingkat di bawahnya dikosongkan; kelurahan ber-kode pos mengisi kode pos.
 */
export const pickRegion = (form, level, item) => {
  const chain = regionChain(form.regionCode);
  const next = { ...form, regionCode: item ? item.kode : (chain[level - 1] || '') };
  REGION_LEVELS.forEach((l, i) => {
    if (i === level) next[l.field] = item ? item.name : '';
    else if (i > level) next[l.field] = '';
    else if (!chain[i]) next[l.field] = ''; // teks lama di atasnya (belum ber-kode) dibuang
  });
  if (item?.kodePos) next.kodePos = item.kodePos;
  return next;
};

/** Form dari hasil getRegion (path provinsi s/d wilayah terpilih) */
export const regionFromPath = (form, path) => {
  const next = { ...form, regionCode: path[path.length - 1]?.kode || '' };
  REGION_LEVELS.forEach((l, i) => { next[l.field] = path[i]?.name || ''; });
  const last = path[path.length - 1];
  if (last?.kodePos) next.kodePos = last.kodePos;
  return next;
};

/** Validasi sisi klien (backend tetap memvalidasi): pesan error atau null */
export const regionError = (form) => {
  if (form.kodePos && !/^\d{5}$/.test(form.kodePos)) return 'Kode pos harus 5 digit.';
  if (!form.latitude !== !form.longitude) return 'Isi latitude dan longitude sekaligus, atau kosongkan keduanya.';
  return null;
};
