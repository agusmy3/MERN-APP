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

/**
 * Biaya angkut Goods Receipt dibagi ke baris menurut nilai (qtyBase x baseUnitCost), atau qty jika semua 0;
 * baris terakhir menerima sisa pembulatan. Salinan backend helpers/purchaseHelper.js allocateFreight.
 */
export const allocateFreight = (lines, freight) => {
  const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const total = r2(Math.max(Number(freight) || 0, 0));
  const weights = lines.map((l) => l.qtyBase * (l.baseUnitCost || 0));
  const sum = weights.reduce((a, b) => a + b, 0);
  const basis = sum > 0 ? weights : lines.map((l) => l.qtyBase);
  const basisSum = basis.reduce((a, b) => a + b, 0);
  let left = total;
  return lines.map((l, i) => {
    const share = i === lines.length - 1 ? left : r2(basisSum ? total * (basis[i] / basisSum) : 0);
    left = r2(left - share);
    const freightCost = total ? share : 0;
    return { ...l, freightCost, unitCost: r2((l.baseUnitCost || 0) + (l.qtyBase ? freightCost / l.qtyBase : 0)) };
  });
};
