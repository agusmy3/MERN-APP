/**
 * Perhitungan penjualan (murni, tanpa database). Salinan frontend: src/utils/salesMeta.js.
 */
const { round2 } = require('./number');

/** Subtotal 1 baris: qty x harga x (1 - diskon%) */
const salesLineSubtotal = ({ qty, hargaJual, diskonPersen = 0 }) => round2(qty * hargaJual * (1 - (diskonPersen || 0) / 100));

/**
 * Total dokumen dari subtotal baris, diskon dokumen (nominal), ongkir & pajak.
 * -> { subtotal, discountAmount, dpp, taxAmount, total, shippingCharge, shippingDpp, shippingTotal }
 * - dpp = DPP BARANG saja (= penjualan bersih); ongkir dicatat terpisah: shippingDpp (tanpa PPN) &
 *   shippingTotal (termasuk PPN). Ongkir mengikuti mode pajak dokumen (termasuk / belum termasuk PPN).
 * - taxAmount = PPN barang + PPN ongkir; total = total barang + shippingTotal.
 */
const salesTotals = (lines, { discountAmount = 0, taxRate = 0, priceIncludesTax = false, shippingCharge = 0 } = {}) => {
  const subtotal = round2(lines.reduce((sum, l) => sum + (l.subtotal ?? salesLineSubtotal(l)), 0));
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

/** Total BARANG (termasuk PPN) dokumen penjualan = total - ongkir (termasuk PPN) */
const goodsTotal = (inv) => round2((inv.total || 0) - (inv.shippingTotal || 0));

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
  // ongkir tidak ikut diretur
  return { subtotal, amount: ratio(goodsTotal(inv)), netAmount: ratio(inv.dpp) };
};

/** Sisa SO per baris (satuan dasar) */
const soOutstanding = (line) => round2(Math.max((line.qty || 0) - (line.qtyDelivered || 0), 0));

/** Status SO dari pengiriman: semua terkirim -> DELIVERED, sebagian -> PARTIAL, belum -> OPEN */
const deliveryStatus = (lines) => {
  if (lines.every((l) => (l.qtyDelivered || 0) >= l.qty)) return 'DELIVERED';
  if (lines.some((l) => (l.qtyDelivered || 0) > 0)) return 'PARTIAL';
  return 'OPEN';
};

module.exports = { salesLineSubtotal, salesTotals, goodsTotal, netLineRevenue, invoiceBalance, returnLineValues, soOutstanding, deliveryStatus };
