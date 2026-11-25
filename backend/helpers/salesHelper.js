/**
 * Perhitungan penjualan (murni, tanpa database). Salinan frontend: src/utils/salesMeta.js.
 */
const { round2 } = require('./number');

/** Subtotal 1 baris: qty x harga x (1 - diskon%) */
const salesLineSubtotal = ({ qty, hargaJual, diskonPersen = 0 }) => round2(qty * hargaJual * (1 - (diskonPersen || 0) / 100));

/**
 * Total dokumen dari subtotal baris, diskon dokumen (nominal) & pajak.
 * -> { subtotal, discountAmount, dpp, taxAmount, total }
 */
const salesTotals = (lines, { discountAmount = 0, taxRate = 0, priceIncludesTax = false } = {}) => {
  const subtotal = round2(lines.reduce((sum, l) => sum + (l.subtotal ?? salesLineSubtotal(l)), 0));
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

/**
 * Pendapatan bersih (tanpa PPN, setelah diskon dokumen dibagi proporsional) per baris,
 * untuk margin per baris. Jumlahnya = dpp (selisih pembulatan kecil mungkin).
 */
const netLineRevenue = (line, totals) => (totals.subtotal ? round2(line.subtotal * (totals.dpp / totals.subtotal)) : 0);

module.exports = { salesLineSubtotal, salesTotals, netLineRevenue };
