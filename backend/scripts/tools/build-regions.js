/**
 * Membuat ulang backend/data/regions.json.gz dari dump SQL (hanya saat data wilayah diperbarui; bukan bagian aplikasi).
 *   1. unduh ke 1 folder kosong (di luar repo):
 *      https://raw.githubusercontent.com/cahyadsn/wilayah/master/db/wilayah.sql
 *      https://raw.githubusercontent.com/cahyadsn/wilayah/master/db/wilayah_level_1_2.sql   (koordinat provinsi & kab/kota)
 *      https://raw.githubusercontent.com/cahyadsn/wilayah_kodepos/main/db/wilayah_kodepos.sql
 *   2. node scripts/tools/build-regions.js <folder> data/regions.json.gz
 *   3. npm run test:unit (cek integritas), lalu npm run regions:import
 * Baris keluaran: [kode, nama, lat?, lng?, kodePos?]. Lisensi data: MIT (cahya dsn).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const [src, out] = process.argv.slice(2);
const read = (f) => fs.readFileSync(path.join(src, f), 'utf8');

// tuple SQL: ('a','b', 1.2, ...) -> array nilai (string / number / null)
function* tuples(sql) {
  const re = /^\((.*)\),?;?\s*$/gm;
  let m;
  while ((m = re.exec(sql))) {
    const s = m[1];
    const vals = [];
    let i = 0;
    while (i < s.length) {
      while (s[i] === ' ' || s[i] === ',') i += 1;
      if (i >= s.length) break;
      if (s[i] === "'") {
        let v = '';
        i += 1;
        while (i < s.length) {
          if (s[i] === '\\') { v += s[i + 1]; i += 2; continue; }
          if (s[i] === "'" && s[i + 1] === "'") { v += "'"; i += 2; continue; }
          if (s[i] === "'") { i += 1; break; }
          v += s[i]; i += 1;
        }
        vals.push(v);
      } else {
        let j = i;
        while (j < s.length && s[j] !== ',') j += 1;
        const raw = s.slice(i, j).trim();
        vals.push(raw === 'NULL' ? null : Number(raw));
        i = j;
      }
      if (vals.length >= 5) break; // cukup kode, nama, ibukota, lat, lng (lewati polygon)
    }
    yield vals;
  }
}

const names = new Map();
for (const [kode, nama] of tuples(read('wilayah.sql'))) names.set(kode, nama.trim());
const coords = new Map();
for (const [kode, , , lat, lng] of tuples(read('wilayah_level_1_2.sql'))) {
  if (typeof lat !== 'number' || typeof lng !== 'number') continue;
  // di luar kotak Indonesia = salah data sumber (mis. Wakatobi lng 23.5) -> dibuang, peta memakai pusat provinsi
  if (lat < -11 || lat > 6 || lng < 94 || lng > 142) { console.warn(`koordinat dibuang: ${kode} ${lat},${lng}`); continue; }
  coords.set(kode, [+lat.toFixed(6), +lng.toFixed(6)]);
}
const pos = new Map();
for (const [kode, kp] of tuples(read('wilayah_kodepos.sql'))) if (kp && /^\d{5}$/.test(kp)) pos.set(kode, kp);

// format ringkas: [kode, nama, lat?, lng?, kodePos?]
const rows = [...names.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([kode, nama]) => {
  const r = [kode, nama];
  const c = coords.get(kode);
  const kp = pos.get(kode);
  if (c || kp) r.push(c ? c[0] : null, c ? c[1] : null);
  if (kp) r.push(kp);
  return r;
});
const levels = [0, 0, 0, 0];
for (const [k] of rows) levels[k.split('.').length - 1] += 1;
const data = {
  source: 'cahyadsn/wilayah (Kepmendagri 300.2.2-2138/2025) + cahyadsn/wilayah_kodepos, MIT License',
  generated: new Date().toISOString().slice(0, 10),
  count: rows.length,
  rows,
};
fs.writeFileSync(out, zlib.gzipSync(JSON.stringify(data), { level: 9 }));
console.log({ total: rows.length, levels, coords: coords.size, kodePos: pos.size, bytes: fs.statSync(out).size });
