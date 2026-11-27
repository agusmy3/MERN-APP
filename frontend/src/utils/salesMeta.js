import { round2 } from './formatHelper';

// Sales Invoice: DRAFT -> POSTED -> CANCELLED
export const INVOICE_STATUS_META = {
  DRAFT: { label: 'Draft', icon: 'fa-pen-ruler', tone: 'bg-warning-soft text-warning-fg' },
  POSTED: { label: 'Posted', icon: 'fa-check', tone: 'bg-success-soft text-success-fg' },
  CANCELLED: { label: 'Cancelled', icon: 'fa-ban', tone: 'bg-danger-soft text-danger' },
};

// Sales Return: status sama dengan invoice
export const RETURN_STATUS_META = INVOICE_STATUS_META;

// status bayar invoice POSTED (sisa = total - retur - dibayar)
export const PAYMENT_STATUS_META = {
  UNPAID: { label: 'Unpaid', icon: 'fa-hourglass-half', tone: 'bg-warning-soft text-warning-fg' },
  PARTIAL: { label: 'Partially paid', icon: 'fa-circle-half-stroke', tone: 'bg-primary-soft text-primary-soft-fg' },
  PAID: { label: 'Paid', icon: 'fa-check-double', tone: 'bg-success-soft text-success-fg' },
  OVERPAID: { label: 'Overpaid', icon: 'fa-arrow-rotate-left', tone: 'bg-danger-soft text-danger' },
};

export const PAYMENT_METHODS = { CASH: 'Cash', CARD: 'Debit / Card', QRIS: 'QRIS', TRANSFER: 'Transfer', OTHER: 'Other' };
export const PAYMENT_TYPES = { PAYMENT: 'Payment', REFUND: 'Refund' };

/** Subtotal 1 baris: qty x harga x (1 - diskon%) (salinan backend/helpers/salesHelper.js) */
export const salesLineSubtotal = ({ qty, hargaJual, diskonPersen = 0 }) => round2((Number(qty) || 0) * (Number(hargaJual) || 0) * (1 - (Number(diskonPersen) || 0) / 100));

/**
 * Total dokumen (salinan backend/helpers/salesHelper.js). priceIncludesTax: PPN dihitung dari dalam
 * (total = subtotal - diskon), selain itu PPN ditambahkan di atas. Ongkir mengikuti mode pajak yang sama;
 * dpp = barang saja, taxAmount & total termasuk ongkir.
 * -> { subtotal, discountAmount, dpp, taxAmount, total, shippingCharge, shippingDpp, shippingTotal }
 */
export const salesTotals = (lines, { discountAmount = 0, taxRate = 0, priceIncludesTax = false, shippingCharge = 0 } = {}) => {
  const subtotal = round2(lines.reduce((sum, l) => sum + salesLineSubtotal(l), 0));
  const discount = round2(Math.min(Math.max(Number(discountAmount) || 0, 0), subtotal));
  const base = round2(subtotal - discount);
  const rate = Number(taxRate) || 0;
  const ship = round2(Math.max(Number(shippingCharge) || 0, 0));
  let goods;
  let shipping;
  if (priceIncludesTax) {
    const taxAmount = round2(base * rate / (100 + rate));
    goods = { dpp: round2(base - taxAmount), taxAmount, total: base };
    const shipTax = round2(ship * rate / (100 + rate));
    shipping = { shippingDpp: round2(ship - shipTax), shipTax, shippingTotal: ship };
  } else {
    const taxAmount = round2(base * rate / 100);
    goods = { dpp: base, taxAmount, total: round2(base + taxAmount) };
    const shipTax = round2(ship * rate / 100);
    shipping = { shippingDpp: ship, shipTax, shippingTotal: round2(ship + shipTax) };
  }
  return {
    subtotal,
    discountAmount: discount,
    dpp: goods.dpp,
    taxAmount: round2(goods.taxAmount + shipping.shipTax),
    total: round2(goods.total + shipping.shippingTotal),
    shippingCharge: ship,
    shippingDpp: shipping.shippingDpp,
    shippingTotal: shipping.shippingTotal,
  };
};

// Sales Order: DRAFT -> OPEN -> PARTIAL -> DELIVERED; CLOSED (sisa tidak dikirim), CANCELLED
export const SO_STATUS_META = {
  DRAFT: { label: 'Draft', icon: 'fa-pen-ruler', tone: 'bg-warning-soft text-warning-fg' },
  OPEN: { label: 'Open', icon: 'fa-file-signature', tone: 'bg-primary-soft text-primary-soft-fg' },
  PARTIAL: { label: 'Partially delivered', icon: 'fa-truck-fast', tone: 'bg-primary-soft text-primary-soft-fg' },
  DELIVERED: { label: 'Delivered', icon: 'fa-check-double', tone: 'bg-success-soft text-success-fg' },
  CLOSED: { label: 'Closed', icon: 'fa-lock', tone: 'bg-subtle text-muted' },
  CANCELLED: { label: 'Cancelled', icon: 'fa-ban', tone: 'bg-danger-soft text-danger' },
};

// Quotation: DRAFT -> SENT -> ACCEPTED (jadi SO) / REJECTED; EXPIRED = SENT lewat masa berlaku (dihitung)
export const QUOTATION_STATUS_META = {
  DRAFT: { label: 'Draft', icon: 'fa-pen-ruler', tone: 'bg-warning-soft text-warning-fg' },
  SENT: { label: 'Sent', icon: 'fa-paper-plane', tone: 'bg-primary-soft text-primary-soft-fg' },
  EXPIRED: { label: 'Expired', icon: 'fa-hourglass-end', tone: 'bg-subtle text-muted' },
  ACCEPTED: { label: 'Accepted', icon: 'fa-check-double', tone: 'bg-success-soft text-success-fg' },
  REJECTED: { label: 'Rejected', icon: 'fa-thumbs-down', tone: 'bg-danger-soft text-danger' },
};
/** status tampilan quotation (SENT kedaluwarsa -> EXPIRED) */
export const quotationStatus = (q) => (q?.expired ? 'EXPIRED' : q?.status);

// Delivery Order: DRAFT -> POSTED -> CANCELLED
export const DO_STATUS_META = INVOICE_STATUS_META;

export const DELIVERY_METHODS = {
  DELIVERY: { label: 'Dikirim', icon: 'fa-truck' },
  PICKUP: { label: 'Diambil sendiri', icon: 'fa-person-walking-luggage' },
};

/** Alamat 1 baris: "Jl. Mawar 1, Menteng, Jakarta Pusat, DKI Jakarta 10310" */
export const addressLine = (a) => (a
  ? [[a.alamat ?? a.address, a.kelurahan, a.kecamatan, a.kota, a.provinsi].filter(Boolean).join(', '), a.kodePos].filter(Boolean).join(' ')
  : '');
