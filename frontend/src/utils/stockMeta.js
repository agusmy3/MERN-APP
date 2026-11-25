/**
 * Konstanta modul stok (salinan dari backend/config/stock.js; key harus sama).
 */

export const ADJUSTMENT_TYPES = {
  ADJUSTMENT: {
    label: 'Adjustment',
    icon: 'fa-sliders',
    hint: 'Isi perubahan stok per SKU (+ menambah, − mengurangi), mis. barang rusak atau koreksi.',
  },
  OPNAME: {
    label: 'Stock Opname',
    icon: 'fa-clipboard-check',
    hint: 'Isi jumlah fisik hasil hitung. Selisih terhadap stok sistem dihitung saat Post.',
  },
};

// alasan Adjustment (OPNAME otomatis untuk dokumen Stock Opname)
export const REASONS = {
  OPNAME: 'Stock Opname',
  DAMAGED: 'Damaged',
  LOST: 'Lost',
  EXPIRED: 'Expired',
  SAMPLE: 'Sample / Promotion',
  CORRECTION: 'Input Correction',
  OPENING: 'Opening Balance',
  OTHER: 'Other',
};
export const ADJUSTMENT_REASONS = Object.keys(REASONS).filter((k) => k !== 'OPNAME');

export const STATUS_META = {
  DRAFT: { label: 'Draft', icon: 'fa-pen-ruler', tone: 'bg-warning-soft text-warning-fg' },
  POSTED: { label: 'Posted', icon: 'fa-check', tone: 'bg-success-soft text-success-fg' },
  CANCELLED: { label: 'Cancelled', icon: 'fa-ban', tone: 'bg-danger-soft text-danger' },
};

export const MOVEMENT_TYPES = {
  OPENING: 'Opening Balance',
  ADJUSTMENT: 'Adjustment',
  OPNAME: 'Stock Opname',
  PURCHASE: 'Purchase (Goods Receipt)',
  REVALUATION: 'Cost Revaluation',
  TRANSFER_OUT: 'Transfer Out',
  TRANSFER_IN: 'Transfer In',
  SALE: 'Sale',
  SALE_RETURN: 'Sales Return',
};

// Stock Transfer: DRAFT -> IN_TRANSIT (dikirim) -> RECEIVED; IN_TRANSIT -> CANCELLED
export const TRANSFER_STATUS_META = {
  DRAFT: { label: 'Draft', icon: 'fa-pen-ruler', tone: 'bg-warning-soft text-warning-fg' },
  IN_TRANSIT: { label: 'In transit', icon: 'fa-truck-fast', tone: 'bg-primary-soft text-primary-soft-fg' },
  RECEIVED: { label: 'Received', icon: 'fa-check', tone: 'bg-success-soft text-success-fg' },
  CANCELLED: { label: 'Cancelled', icon: 'fa-ban', tone: 'bg-danger-soft text-danger' },
};
