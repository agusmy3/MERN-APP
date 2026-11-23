/**
 * Registri System Settings (variabel global) — sumber kebenaran daftar key, tipe, default & batas.
 * Nilai disimpan di koleksi `settings` (model Setting); key yang belum disimpan memakai `default`.
 * Menambah setting: tambahkan di sini, lalu baca dengan getSettings() (helpers/settings.js).
 *
 * Dokumen yang bergantung pada setting MENYALIN nilainya saat dibuat/diterbitkan
 * (mis. PO menyimpan isPKP & taxRate), jadi mengubah setting tidak mengubah dokumen lama.
 */
const SETTINGS = [
  {
    key: 'tax.isPKP',
    label: 'Company is PKP',
    group: 'Tax',
    type: 'bool',
    default: true,
    description: 'Pengusaha Kena Pajak: PPN masukan bisa dikreditkan, jadi HPP dihitung TANPA PPN. '
      + 'Jika tidak PKP, PPN pembelian ikut menjadi bagian HPP.',
  },
  {
    key: 'tax.ppnRate',
    label: 'PPN rate (%)',
    group: 'Tax',
    type: 'number',
    default: 11,
    min: 0,
    max: 100,
    description: 'Tarif PPN default untuk Purchase Order baru (bisa diubah per PO selama draft; 0 = vendor non-PKP).',
  },
];

const getDefinition = (key) => SETTINGS.find((s) => s.key === key);

module.exports = { SETTINGS, getDefinition };
