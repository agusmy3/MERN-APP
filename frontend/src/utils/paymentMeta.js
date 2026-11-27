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

// ---------- potongan (write-off) & deposit ----------

/** Alasan potongan per sisi (sama dengan backend helpers/paymentHelper.js SIDES) */
export const WRITE_OFF_REASONS = {
  sales: { DISCOUNT: 'Potongan tunai', BANK_FEE: 'Biaya transfer', ROUNDING: 'Pembulatan', BAD_DEBT: 'Piutang tak tertagih' },
  purchase: { DISCOUNT: 'Potongan dari vendor', ROUNDING: 'Pembulatan', OTHER: 'Lainnya (isi catatan)' },
};
export const writeOffLabel = (reason) => WRITE_OFF_REASONS.sales[reason] || WRITE_OFF_REASONS.purchase[reason] || reason || '';

export const DEPOSIT_SOURCES = {
  DIRECT: 'Uang muka',
  BATCH: 'Kelebihan pembayaran gabungan',
  OVERPAYMENT: 'Kelebihan bayar invoice',
};

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
/** Saldo deposit yang masih bisa dipakai */
export const depositBalance = (d) => (d?.status === 'POSTED'
  ? r2((d.amount || 0) - (d.usedAmount || 0) - (d.refundedAmount || 0) - (d.writtenOffAmount || 0)) : 0);

/**
 * Ringkasan pembayaran gabungan di form: uang baru + deposit dipakai vs alokasi (+ potongan per invoice).
 * -> { funds, depositTotal, allocated, writeOff, leftover (uang baru tersisa -> deposit baru), error }
 */
export const batchPlan = ({ amount = 0, deposits = {}, alloc = {}, writeOffs = {}, invoices = [] }) => {
  const depositTotal = r2(Object.values(deposits).reduce((s, v) => s + (Number(v) || 0), 0));
  const cash = r2(amount);
  const funds = r2(cash + depositTotal);
  const allocated = r2(Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0));
  const writeOff = r2(Object.values(writeOffs).reduce((s, v) => s + (Number(v) || 0), 0));
  let error = null;
  const over = invoices.find((i) => r2((Number(alloc[i._id]) || 0) + (Number(writeOffs[i._id]) || 0)) > i.balance);
  if (over) error = `${over.no}: bayar + potongan melebihi sisa ${over.balance}`;
  else if (allocated > funds) error = 'Alokasi melebihi uang yang tersedia';
  else if (depositTotal > allocated) error = 'Deposit yang dipakai harus habis dialokasikan ke invoice';
  return { funds, depositTotal, allocated, writeOff, leftover: error ? 0 : r2(funds - allocated), error };
};

/** Alasan hapus saldo deposit (backend helpers/depositSchema.js DEPOSIT_WRITE_OFF_REASONS) */
export const DEPOSIT_WRITE_OFF_REASONS = {
  sales: { FORFEITED: 'Hangus (tidak dipakai / tidak diminta kembali)', OTHER: 'Lainnya' },
  purchase: { VENDOR_DISPUTE: 'Vendor tidak mengakui', VENDOR_CLOSED: 'Vendor tutup / tidak bisa dihubungi', OTHER: 'Lainnya' },
};
export const depositWriteOffLabel = (reason) => DEPOSIT_WRITE_OFF_REASONS.purchase[reason] || DEPOSIT_WRITE_OFF_REASONS.sales[reason] || reason || '';
