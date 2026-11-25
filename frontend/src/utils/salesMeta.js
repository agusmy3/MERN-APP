import { round2 } from './formatHelper';

// Sales Invoice: DRAFT -> POSTED -> CANCELLED
export const INVOICE_STATUS_META = {
  DRAFT: { label: 'Draft', icon: 'fa-pen-ruler', tone: 'bg-warning-soft text-warning-fg' },
  POSTED: { label: 'Posted', icon: 'fa-check', tone: 'bg-success-soft text-success-fg' },
  CANCELLED: { label: 'Cancelled', icon: 'fa-ban', tone: 'bg-danger-soft text-danger' },
};

/** Subtotal 1 baris: qty x harga x (1 - diskon%) (salinan backend/helpers/salesHelper.js) */
export const salesLineSubtotal = ({ qty, hargaJual, diskonPersen = 0 }) => round2((Number(qty) || 0) * (Number(hargaJual) || 0) * (1 - (Number(diskonPersen) || 0) / 100));

/**
 * Total dokumen. priceIncludesTax: PPN dihitung dari dalam (total = subtotal - diskon),
 * selain itu PPN ditambahkan di atas. -> { subtotal, discountAmount, dpp, taxAmount, total }
 */
export const salesTotals = (lines, { discountAmount = 0, taxRate = 0, priceIncludesTax = false } = {}) => {
  const subtotal = round2(lines.reduce((sum, l) => sum + salesLineSubtotal(l), 0));
  const discount = round2(Math.min(Math.max(Number(discountAmount) || 0, 0), subtotal));
  const base = round2(subtotal - discount);
  const rate = Number(taxRate) || 0;
  if (priceIncludesTax) {
    const taxAmount = round2(base * rate / (100 + rate));
    return { subtotal, discountAmount: discount, dpp: round2(base - taxAmount), taxAmount, total: base };
  }
  const taxAmount = round2(base * rate / 100);
  return { subtotal, discountAmount: discount, dpp: base, taxAmount, total: round2(base + taxAmount) };
};
