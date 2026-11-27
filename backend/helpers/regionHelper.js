const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const Region = require('../models/Region');

/**
 * Master wilayah (koleksi `regions`). Sumber: backend/data/regions.json.gz, hasil konversi
 * cahyadsn/wilayah (Kepmendagri) + cahyadsn/wilayah_kodepos (MIT). Baris: [kode, nama, lat?, lng?, kodePos?].
 */
const DATA_FILE = path.join(__dirname, '..', 'data', 'regions.json.gz');
const LEVEL_LABEL = { 1: 'Province', 2: 'City / Regency', 3: 'District', 4: 'Village' };
const CODE_RX = /^\d{2}(\.\d{2}(\.\d{2}(\.\d{4})?)?)?$/;

const levelOf = (kode) => kode.split('.').length;
const parentOf = (kode) => (kode.includes('.') ? kode.slice(0, kode.lastIndexOf('.')) : null);
/** "32.73.02.1001" -> ["32", "32.73", "32.73.02", "32.73.02.1001"] */
const ancestorCodes = (kode) => kode.split('.').map((_, i, parts) => parts.slice(0, i + 1).join('.'));

const readRegionFile = (file = DATA_FILE) => JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));

const toDoc = ([kode, name, lat = null, lng = null, kodePos = null]) => ({
  _id: kode,
  level: levelOf(kode),
  name,
  parent: parentOf(kode),
  lat: lat ?? null,
  lng: lng ?? null,
  kodePos: kodePos ?? null,
  isActive: true,
});

const sameDoc = (a, b) => ['level', 'name', 'parent', 'lat', 'lng', 'kodePos', 'isActive'].every((k) => (a[k] ?? null) === (b[k] ?? null));

/**
 * Sinkronkan koleksi regions dengan data (idempotent): tambah kode baru, perbarui yang berubah,
 * kode yang tidak ada lagi -> isActive false (tidak dihapus). Hanya dokumen yang berbeda yang ditulis.
 * Data referensi (bukan input user): tidak diaudit, tidak di dalam transaksi (puluhan ribu baris).
 */
async function importRegions({ rows } = {}) {
  const source = rows || readRegionFile().rows;
  const docs = source.map(toDoc);
  for (const d of docs) {
    if (!CODE_RX.test(d._id) || !d.name) throw new Error(`Invalid region row: ${JSON.stringify(d)}`);
  }
  await Region.createCollection().catch(() => {});
  await Region.createIndexes();

  const existing = new Map((await Region.find().lean()).map((r) => [r._id, r]));
  const ops = [];
  let added = 0;
  let updated = 0;
  for (const d of docs) {
    const old = existing.get(d._id);
    existing.delete(d._id);
    if (!old) added += 1;
    else if (sameDoc(old, d)) continue;
    else updated += 1;
    ops.push({ replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true } });
  }
  const retired = [...existing.values()].filter((r) => r.isActive).map((r) => r._id);
  if (retired.length) ops.push({ updateMany: { filter: { _id: { $in: retired } }, update: { $set: { isActive: false } } } });
  for (let i = 0; i < ops.length; i += 5000) {
    await Region.bulkWrite(ops.slice(i, i + 5000), { ordered: false });
  }
  return { total: docs.length, added, updated, retired: retired.length };
}

/** Rantai wilayah dari provinsi sampai kode tsb (yang ada di database), urut dari provinsi. */
async function regionPath(kode) {
  const codes = ancestorCodes(kode);
  const list = await Region.find({ _id: { $in: codes } }).lean();
  const byId = new Map(list.map((r) => [r._id, r]));
  return codes.map((c) => byId.get(c)).filter(Boolean);
}

/** Titik tengah untuk peta: koordinat wilayah itu sendiri atau leluhur terdekat yang punya koordinat. */
const centerOf = (chain) => {
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    if (chain[i].lat != null && chain[i].lng != null) return { lat: chain[i].lat, lng: chain[i].lng, level: chain[i].level };
  }
  return null;
};

const toItem = (r) => ({
  kode: r._id,
  name: r.name,
  level: r.level,
  parent: r.parent,
  ...(r.kodePos ? { kodePos: r.kodePos } : {}),
  ...(r.isActive === false ? { isActive: false } : {}),
});

// ---------- mencocokkan teks wilayah lama (bebas) ke master ----------
const PREFIX = {
  1: /^(provinsi|prov|daerah khusus ibukota|daerah khusus|dki|daerah istimewa|d ?i)\s+/,
  2: /^(kota administrasi|kabupaten administrasi|kota adm|kab adm|kabupaten|kab|kota|kodya)\s+/,
  3: /^(kecamatan|kec)\s+/,
  4: /^(kelurahan|kel|desa|ds)\s+/,
};
const PROVINCE_ALIAS = {
  jabar: '32', jateng: '33', jatim: '35', jogja: '34', diy: '34', ntb: '52', ntt: '53', babel: '19', 'bangka belitung': '19',
  kepri: '21', sumut: '12', sumbar: '13', sumsel: '16', kalbar: '61', kalteng: '62', kalsel: '63', kaltim: '64', kaltara: '65',
  sulut: '71', sulteng: '72', sulsel: '73', sultra: '74', sulbar: '76', nad: '11', 'nanggroe aceh darussalam': '11',
};
/** "Kab. Bandung" -> "bandung", "DKI Jakarta" -> "jakarta", "Kec. Coblong" -> "coblong" */
const normRegion = (text, level) => {
  let x = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (let prev = null; prev !== x;) { prev = x; x = x.replace(PREFIX[level], '').trim(); }
  return x;
};

/**
 * Cocokkan teks wilayah (provinsi, kota, kecamatan, kelurahan) ke master, dari atas ke bawah; berhenti di tingkat
 * yang tidak cocok / ambigu. Kota ambigu (Kota vs Kabupaten Bandung) diputuskan dari kata "kota"/"kab" di teks,
 * lalu dari kecamatan yang ada di dalamnya. Provinsi kosong -> kota dicari di seluruh Indonesia (harus unik).
 * -> { regionCode, names: { provinsi, kota, kecamatan, kelurahan } (tingkat yang cocok), level, issue }
 */
async function matchRegion(input) {
  const want = { 1: input.provinsi, 2: input.kota, 3: input.kecamatan, 4: input.kelurahan };
  const result = { regionCode: null, names: {}, level: 0, issue: null };
  const accept = (r) => {
    result.regionCode = r._id;
    result.level = r.level;
    result.names[['provinsi', 'kota', 'kecamatan', 'kelurahan'][r.level - 1]] = r.name;
  };
  const childrenOf = (parent) => Region.find({ parent, isActive: true }).select('name level parent').lean();
  const candidates = (list, level) => {
    const key = normRegion(want[level], level);
    return key ? list.filter((r) => normRegion(r.name, level) === key) : [];
  };

  let current = null;
  if (normRegion(want[1], 1)) {
    const provinces = await childrenOf(null);
    const alias = PROVINCE_ALIAS[normRegion(want[1], 1)];
    current = alias ? provinces.find((p) => p._id === alias) : candidates(provinces, 1)[0];
    if (!current) { result.issue = `province "${want[1]}" not found`; return result; }
    accept(current);
  }
  if (!normRegion(want[2], 2)) return result;
  let cities = current ? candidates(await childrenOf(current._id), 2)
    : candidates(await Region.find({ level: 2, isActive: true }).select('name level parent').lean(), 2);
  if (cities.length > 1) {
    const raw = String(want[2]).toLowerCase();
    const typed = cities.filter((c) => (/\bkab/.test(raw) ? /^Kabupaten/ : /\bkota\b/.test(raw) ? /^Kota/ : /./).test(c.name));
    if (typed.length) cities = typed;
  }
  if (cities.length > 1 && normRegion(want[3], 3)) {
    const withDistrict = [];
    for (const c of cities) if (candidates(await childrenOf(c._id), 3).length) withDistrict.push(c);
    if (withDistrict.length) cities = withDistrict;
  }
  if (cities.length !== 1) { result.issue = `city / regency "${want[2]}" ${cities.length ? 'is ambiguous' : 'not found'}`; return result; }
  if (!current) {
    const prov = await Region.findById(cities[0].parent).lean();
    accept(prov);
  }
  accept(cities[0]);
  current = cities[0];
  for (const level of [3, 4]) {
    if (!normRegion(want[level], level)) return result;
    const found = candidates(await childrenOf(current._id), level);
    if (found.length !== 1) {
      result.issue = `${level === 3 ? 'district' : 'village'} "${want[level]}" ${found.length ? 'is ambiguous' : 'not found'}`;
      return result;
    }
    accept(found[0]);
    current = found[0];
  }
  return result;
}

module.exports = {
  normRegion, matchRegion,
  DATA_FILE, LEVEL_LABEL, CODE_RX, levelOf, parentOf, ancestorCodes, readRegionFile, importRegions, regionPath, centerOf, toItem,
};
