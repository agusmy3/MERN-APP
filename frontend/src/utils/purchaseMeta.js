/** Status Purchase Order & Goods Receipt (key sama dengan backend) */
export const PO_STATUS_META = {
  DRAFT: { label: 'Draft', icon: 'fa-pen-ruler', tone: 'bg-warning-soft text-warning-fg' },
  OPEN: { label: 'Open', icon: 'fa-paper-plane', tone: 'bg-primary-soft text-primary-soft-fg' },
  PARTIAL: { label: 'Partially received', icon: 'fa-truck-ramp-box', tone: 'bg-primary-soft text-primary-soft-fg' },
  RECEIVED: { label: 'Received', icon: 'fa-check', tone: 'bg-success-soft text-success-fg' },
  CLOSED: { label: 'Closed', icon: 'fa-lock', tone: 'bg-subtle text-muted' },
  CANCELLED: { label: 'Cancelled', icon: 'fa-ban', tone: 'bg-danger-soft text-danger' },
};

export const GR_STATUS_META = {
  DRAFT: { label: 'Draft', icon: 'fa-pen-ruler', tone: 'bg-warning-soft text-warning-fg' },
  POSTED: { label: 'Posted', icon: 'fa-check', tone: 'bg-success-soft text-success-fg' },
  CANCELLED: { label: 'Cancelled', icon: 'fa-ban', tone: 'bg-danger-soft text-danger' },
};

/** Subtotal 1 baris PO (sama dengan backend helpers/purchaseHelper.js) */
export const lineSubtotal = (l) => {
  const n = Number(l.qty) * Number(l.hargaBeli) * (1 - Number(l.diskonPersen || 0) / 100);
  return Math.round((n + Number.EPSILON) * 100) / 100;
};
