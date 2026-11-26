/**
 * Konstanta modul stok (dipakai backend; frontend punya salinannya di src/utils/stockMeta.js).
 */

// Jenis dokumen penyesuaian stok
const ADJUSTMENT_TYPES = {
  ADJUSTMENT: { label: 'Adjustment', prefix: 'ADJ' }, // user mengisi PERUBAHAN (+/-)
  OPNAME: { label: 'Stock Opname', prefix: 'OPN' },   // user mengisi jumlah FISIK; selisih dihitung saat post
};

// Alasan penyesuaian. OPNAME hanya untuk dokumen Stock Opname; OTHER wajib catatan.
const REASONS = {
  OPNAME: 'Stock Opname',
  DAMAGED: 'Damaged',
  LOST: 'Lost',
  EXPIRED: 'Expired',
  SAMPLE: 'Sample / Promotion',
  CORRECTION: 'Input Correction',
  OPENING: 'Opening Balance',
  OTHER: 'Other',
};

const STATUSES = ['DRAFT', 'POSTED', 'CANCELLED'];

// Jenis pergerakan stok (kartu stok). Modul berikutnya menambah PURCHASE, SALE, RETURN, TRANSFER, ...
const MOVEMENT_TYPES = {
  OPENING: 'Opening Balance',
  ADJUSTMENT: 'Adjustment',
  OPNAME: 'Stock Opname',
  PURCHASE: 'Purchase (Goods Receipt)',
  REVALUATION: 'Cost Revaluation',   // qty 0, hanya nilai (HPP) yang berubah
  TRANSFER_OUT: 'Transfer Out',       // kirim ke gudang lain (pembalik = transfer dibatalkan)
  TRANSFER_IN: 'Transfer In',         // terima dari gudang lain (HPP saat dikirim)
  SALE: 'Sale',                       // penjualan (Sales Invoice); pembalik = invoice dibatalkan
  SALE_RETURN: 'Sales Return',        // retur penjualan (masuk dengan HPP saat dijual)
  PURCHASE_RETURN: 'Purchase Return', // retur ke vendor (keluar dengan HPP penerimaan, HPP rata-rata dihitung ulang)
};

// batas baris per dokumen (opname 1 gudang bisa ratusan SKU)
const MAX_LINES = 2000;

module.exports = { ADJUSTMENT_TYPES, REASONS, STATUSES, MOVEMENT_TYPES, MAX_LINES };
