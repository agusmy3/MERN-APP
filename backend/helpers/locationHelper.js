const { HttpError } = require('./transaction');
const { CODE_RX, regionPath } = require('./regionHelper');

/**
 * Lokasi (Gudang, Outlet, Customer, Vendor, alamat kirim SO): alamat, wilayah (provinsi, kota/kabupaten,
 * kecamatan, kelurahan/desa), kode pos 5 digit, koordinat derajat desimal (keduanya diisi atau keduanya kosong,
 * maks. 7 desimal).
 *
 * Wilayah dipilih dari master `regions`: `regionCode` = kode terdalam yang dipilih (mis. kelurahan
 * "32.73.02.1001", atau kecamatan bila kelurahan belum dipilih). `resolveRegion` mengisi nama provinsi..kelurahan
 * dari master (input teks diabaikan) dan kode pos kelurahan bila kosong. Tanpa regionCode (data lama) nama
 * wilayah tetap teks bebas.
 */
const TEXT_FIELDS = ['alamat', 'provinsi', 'kota', 'kecamatan', 'kelurahan', 'deskripsi'];
const REGION_NAME_FIELDS = ['provinsi', 'kota', 'kecamatan', 'kelurahan'];
const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';

/**
 * Validasi & normalisasi field lokasi dari body. Hanya field yang dikirim yang dikembalikan
 * (update parsial). Koordinat: keduanya diisi atau keduanya kosong, maks. 7 desimal (~1 cm).
 */
const parseLocation = (body) => {
  const out = {};
  for (const f of TEXT_FIELDS) {
    if (body[f] !== undefined) out[f] = isBlank(body[f]) ? '' : String(body[f]).trim();
  }
  if (body.regionCode !== undefined) {
    const code = isBlank(body.regionCode) ? null : String(body.regionCode).trim();
    if (code && !CODE_RX.test(code)) throw new HttpError('Invalid region code', 400);
    out.regionCode = code;
  }
  if (body.kodePos !== undefined) {
    const kodePos = isBlank(body.kodePos) ? '' : String(body.kodePos).trim();
    if (kodePos && !/^\d{5}$/.test(kodePos)) throw new HttpError('Postal code must be 5 digits', 400);
    out.kodePos = kodePos;
  }
  if (body.latitude !== undefined || body.longitude !== undefined) {
    const latBlank = isBlank(body.latitude);
    const lngBlank = isBlank(body.longitude);
    if (latBlank !== lngBlank) throw new HttpError('Fill in both latitude and longitude, or leave both empty', 400);
    if (latBlank) {
      out.latitude = null;
      out.longitude = null;
    } else {
      const lat = Number(body.latitude);
      const lng = Number(body.longitude);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new HttpError('Latitude must be between -90 and 90', 400);
      if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new HttpError('Longitude must be between -180 and 180', 400);
      out.latitude = Math.round(lat * 1e7) / 1e7;
      out.longitude = Math.round(lng * 1e7) / 1e7;
    }
  }
  return out;
};

/**
 * Wilayah + kode pos + koordinat saja (Customer & Vendor, yang alamat jalannya punya field sendiri).
 * Hanya field yang dikirim yang dikembalikan.
 */
const REGION_FIELDS = ['provinsi', 'kota', 'kecamatan', 'kelurahan', 'regionCode', 'kodePos', 'latitude', 'longitude'];
const parseRegion = (body) => {
  const picked = {};
  REGION_FIELDS.forEach((f) => { if (body[f] !== undefined) picked[f] = body[f]; });
  const out = parseLocation(picked);
  REGION_NAME_FIELDS.forEach((f) => { if (out[f] !== undefined) out[f] = out[f].slice(0, 120); });
  return out;
};

/**
 * Lengkapi hasil parseLocation / parseRegion dari master wilayah (async, boleh di dalam transaksi).
 * - regionCode tidak dikirim: tidak ada yang diubah (update parsial / data lama).
 * - regionCode null: kode dihapus, nama wilayah = teks yang dikirim (data lama).
 * - regionCode diisi: harus ada & aktif (kecuali sama dengan kode yang sudah tersimpan di `current`);
 *   nama provinsi..kelurahan diambil dari master (tingkat yang tidak dipilih = kosong); kode pos kosong
 *   -> kode pos kelurahan. Mengubah `out` dan mengembalikannya.
 */
const resolveRegion = async (out, current = null) => {
  if (!out || !out.regionCode) return out;
  const chain = await regionPath(out.regionCode);
  const self = chain[chain.length - 1];
  if (!self || self._id !== out.regionCode || chain.length !== self.level) throw new HttpError('Region not found. Pick the region again from the list', 400);
  if (self.isActive === false && current?.regionCode !== out.regionCode) {
    throw new HttpError(`Region "${self.name}" is no longer valid. Pick the region again from the list`, 400);
  }
  REGION_NAME_FIELDS.forEach((f, i) => { out[f] = chain[i]?.name || ''; });
  // kode pos kosong -> kode pos kelurahan (kode pos yang tidak dikirim & sudah tersimpan dipertahankan)
  if (!out.kodePos && self.kodePos && !(out.kodePos === undefined && current?.kodePos)) out.kodePos = self.kodePos;
  return out;
};

module.exports = {
  parseLocation, parseRegion, resolveRegion, REGION_FIELDS, REGION_NAME_FIELDS, LOCATION_TEXT_FIELDS: TEXT_FIELDS,
};
