/** Pembayaran gabungan (murni, tanpa service) */
export const BATCH_METHODS = { CASH: 'Cash', TRANSFER: 'Transfer', OTHER: 'Other' };

/**
 * Bagi jumlah ke invoice berurutan (jatuh tempo tertua dulu): tiap invoice maks. sisanya.
 * invoices: [{ _id, balance }] -> { [id]: amount } (0 tidak dicantumkan)
 */
export const allocateFifo = (invoices, amount) => {
  let left = Math.round((Number(amount) || 0) * 100);
  const out = {};
  for (const inv of invoices) {
    if (left <= 0) break;
    const take = Math.min(left, Math.round(inv.balance * 100));
    if (take > 0) out[inv._id] = take / 100;
    left -= take;
  }
  return out;
};
