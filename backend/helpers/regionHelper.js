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

module.exports = {
  DATA_FILE, LEVEL_LABEL, CODE_RX, levelOf, parentOf, ancestorCodes, readRegionFile, importRegions, regionPath, centerOf, toItem,
};
