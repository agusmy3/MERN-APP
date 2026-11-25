const { HttpError } = require('./transaction');

/**
 * Lokasi (Gudang & Outlet): alamat, provinsi, kota/kabupaten, kecamatan (teks bebas), kode pos 5 digit,
 * koordinat derajat desimal (keduanya diisi atau keduanya kosong, maks. 7 desimal).
 */
const TEXT_FIELDS = ['alamat', 'provinsi', 'kota', 'kecamatan', 'deskripsi'];
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

module.exports = { parseLocation, LOCATION_TEXT_FIELDS: TEXT_FIELDS };
