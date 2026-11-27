/**
 * Isi kode wilayah (regionCode) Gudang, Outlet, Vendor & Customer lama dari teks provinsi / kota / kecamatan
 * (/ kelurahan) — idempotent (record yang sudah punya regionCode dilewati). Butuh master wilayah
 * (`npm run regions:import`) lebih dulu.
 *   cd backend && npm run migrate:region-codes            # dry-run: hanya laporan
 *   cd backend && npm run migrate:region-codes -- --apply # tulis
 *
 * Teks dicocokkan dari provinsi ke bawah (helpers/regionHelper.js matchRegion); berhenti di tingkat yang tidak
 * cocok / ambigu. Yang cocok: regionCode = tingkat terdalam yang cocok, nama tingkat itu diganti nama resmi;
 * teks tingkat di bawahnya yang tidak cocok dibiarkan (dilaporkan, user memilih ulang di form). Dokumen
 * (alamat kirim SO / surat jalan) tidak diubah: salinan saat dokumen dibuat.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const mongoose = require('mongoose');
const Region = require('../models/Region');
const { matchRegion } = require('../helpers/regionHelper');

const TARGETS = [
  { model: 'Gudang', label: (d) => d.code },
  { model: 'Outlet', label: (d) => d.code },
  { model: 'Vendor', label: (d) => d.companyName },
  { model: 'Customer', label: (d) => `${d.code} ${d.name}` },
];

async function migrateRegionCodes({ apply = false, log = () => {} } = {}) {
  if (!(await Region.exists({}))) throw new Error('Master wilayah kosong. Jalankan dulu: npm run regions:import');
  const summary = { checked: 0, full: 0, partial: 0, unmatched: 0, written: 0, issues: [] };
  for (const t of TARGETS) {
    const M = require(`../models/${t.model}`);
    const docs = await M.find({
      regionCode: { $in: [null, ''] },
      $or: ['provinsi', 'kota', 'kecamatan', 'kelurahan'].map((f) => ({ [f]: { $nin: [null, ''] } })),
    }).lean();
    for (const d of docs) {
      summary.checked += 1;
      const m = await matchRegion(d);
      const name = `${t.model} ${t.label(d)}`;
      if (!m.regionCode) {
        summary.unmatched += 1;
        summary.issues.push(`${name}: ${m.issue || 'no match'}`);
        log(`[x] ${name}: ${m.issue || 'tidak cocok'}`);
        continue;
      }
      if (m.issue) {
        summary.partial += 1;
        summary.issues.push(`${name}: ${m.issue}`);
      } else summary.full += 1;
      const set = { regionCode: m.regionCode, ...m.names };
      log(`${m.issue ? '[~]' : '[+]'} ${name}: ${m.regionCode} ${Object.values(m.names).join(' / ')}${m.issue ? ` — ${m.issue}` : ''}`);
      if (apply) {
        await M.updateOne({ _id: d._id, regionCode: { $in: [null, ''] } }, { $set: set });
        summary.written += 1;
      }
    }
  }
  return summary;
}

async function main() {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGO_URI);
  const s = await migrateRegionCodes({ apply, log: console.log });
  console.log(`\n${s.checked} record diperiksa: ${s.full} cocok penuh, ${s.partial} cocok sebagian, ${s.unmatched} tidak cocok.`);
  console.log(apply ? `[OK] ${s.written} record diperbarui.` : 'Dry-run: belum ada yang ditulis. Jalankan dengan -- --apply untuk menerapkan.');
  if (s.partial || s.unmatched) console.log('Record sebagian / tidak cocok: pilih ulang wilayahnya di form (data teks lama tetap tersimpan).');
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error(`[!] ${err.message}`);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}

module.exports = { migrateRegionCodes };
