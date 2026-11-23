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
};

// batas baris per dokumen (opname 1 gudang bisa ratusan SKU)
const MAX_LINES = 2000;

module.exports = { ADJUSTMENT_TYPES, REASONS, STATUSES, MOVEMENT_TYPES, MAX_LINES };
