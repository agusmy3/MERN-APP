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

/**
 * Sisa tagihan & status bayar invoice POSTED: sisa = total - retur - dibayar.
 *   > 0 : UNPAID (belum ada bayar) / PARTIAL;  = 0 : PAID;  < 0 : OVERPAID (kelebihan -> refund)
 */
const invoiceBalance = (inv) => {
  const balance = round2((inv.total || 0) - (inv.returnedAmount || 0) - (inv.paidAmount || 0));
  let paymentStatus = 'PAID';
  if (balance > 0) paymentStatus = (inv.paidAmount || 0) > 0 ? 'PARTIAL' : 'UNPAID';
  else if (balance < 0) paymentStatus = 'OVERPAID';
  return { balance, paymentStatus };
};

/**
 * Nilai 1 baris retur dari baris invoice: harga bersih per unit (setelah diskon baris) x qty,
 * lalu dibagi proporsional seperti invoice (diskon dokumen & PPN).
 * -> { subtotal, amount (termasuk PPN, mengurangi tagihan), netAmount (dpp, mengurangi penjualan) }
 */
const returnLineValues = (invLine, qty, inv) => {
  const subtotal = invLine.qty ? round2((invLine.subtotal / invLine.qty) * qty) : 0;
  const ratio = (v) => (inv.subtotal ? round2(subtotal * (v / inv.subtotal)) : 0);
  return { subtotal, amount: ratio(inv.total), netAmount: ratio(inv.dpp) };
};

module.exports = { salesLineSubtotal, salesTotals, netLineRevenue, invoiceBalance, returnLineValues };
