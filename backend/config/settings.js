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
    description: 'Tarif PPN default untuk Purchase Order baru (bisa diubah per PO selama draft; 0 = vendor non-PKP) '
      + 'dan Sales Invoice baru (jika perusahaan PKP; non-PKP = 0).',
  },
  {
    key: 'sales.priceIncludesTax',
    label: 'Selling price includes PPN',
    group: 'Sales',
    type: 'bool',
    default: false,
    description: 'Harga jual sudah termasuk PPN (umum di retail): PPN dihitung dari dalam total. '
      + 'Jika tidak, PPN ditambahkan di atas harga. Disalin ke Sales Invoice saat dibuat (bisa diubah per dokumen selama draft).',
  },
  {
    key: 'sales.blockOverdue',
    label: 'Block sales orders for overdue customers',
    group: 'Sales',
    type: 'bool',
    default: true,
    description: 'Konfirmasi Sales Order ditolak jika customer punya invoice belum lunas yang lewat jatuh tempo '
      + '(bisa disetujui user dengan izin Sales Order: Approve). Batas kredit diatur per customer.',
  },
  {
    key: 'payment.writeOffLimit',
    label: 'Write-off limit without approval',
    group: 'Payment',
    type: 'number',
    default: 10000,
    min: 0,
    max: 1000000000,
    description: 'Potongan (pembulatan, biaya transfer, potongan tunai) per invoice / tagihan saat mencatat pembayaran. '
      + 'Di atas nilai ini, dan semua penghapusan piutang tak tertagih, butuh izin Sales Payment / Vendor Payment: Approve. 0 = selalu butuh persetujuan.',
  },
  // identitas perusahaan: dicetak di kop dokumen (SO, invoice, quotation, surat jalan)
  { key: 'company.name', label: 'Company name', group: 'Company', type: 'text', default: '', maxLength: 120, description: 'Kop dokumen cetak (Sales Order, Invoice, Quotation, Surat Jalan).' },
  {
    key: 'company.logo', label: 'Logo', group: 'Company', type: 'image', default: '', maxBytes: 200 * 1024,
    description: 'Logo di kop dokumen cetak (PNG / JPEG / WEBP, otomatis diperkecil; maks. 200 KB). Kosong = tanpa logo.',
  },
  { key: 'company.address', label: 'Address', group: 'Company', type: 'text', multiline: true, default: '', maxLength: 500 },
  { key: 'company.phone', label: 'Phone', group: 'Company', type: 'text', default: '', maxLength: 60 },
  { key: 'company.email', label: 'Email', group: 'Company', type: 'text', default: '', maxLength: 120 },
  { key: 'company.npwp', label: 'NPWP', group: 'Company', type: 'text', default: '', maxLength: 40 },
  {
    key: 'company.bankInfo', label: 'Payment instructions', group: 'Company', type: 'text', multiline: true, default: '', maxLength: 500,
    description: 'Rekening bank / cara bayar, dicetak di invoice & quotation.',
  },
  {
    key: 'company.documentFooter', label: 'Document footer', group: 'Company', type: 'text', multiline: true, default: '', maxLength: 500,
    description: 'Catatan kaki dokumen penjualan cetak (mis. syarat & ketentuan).',
  },
];

const getDefinition = (key) => SETTINGS.find((s) => s.key === key);

module.exports = { SETTINGS, getDefinition };
