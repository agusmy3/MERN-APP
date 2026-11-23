/**
 * Perhitungan bersama Purchase Order & Goods Receipt (murni, tanpa database).
 */
const { round2 } = require('./number');

/** Subtotal 1 baris PO: qty x harga x (1 - diskon%) */
const lineSubtotal = ({ qty, hargaBeli, diskonPersen = 0 }) => round2(qty * hargaBeli * (1 - diskonPersen / 100));

/** Total PO dari barisnya: { subtotal, taxAmount, total } */
const poTotals = (lines, taxRate) => {
  const subtotal = round2(lines.reduce((sum, l) => sum + l.subtotal, 0));
  const taxAmount = round2(subtotal * (taxRate || 0) / 100);
  return { subtotal, taxAmount, total: round2(subtotal + taxAmount) };
};

/**
 * HPP masuk per satuan dasar untuk 1 baris PO:
 *   harga x (1 - diskon) [x (1 + PPN) jika perusahaan BUKAN PKP, karena PPN tidak bisa dikreditkan] / konversi
 */
const unitCostOf = (po, line) => {
  const net = line.hargaBeli * (1 - (line.diskonPersen || 0) / 100);
  const withTax = po.isPKP ? net : net * (1 + (po.taxRate || 0) / 100);
  return round2(withTax / line.konversi);
};

/** Sisa yang belum diterima (dalam satuan beli) */
const outstandingOf = (line) => Math.max(round2(line.qty - (line.qtyReceived || 0)), 0);

/** Status PO dari penerimaan barisnya (dipakai saat GR di-post / dibatalkan) */
const receiptStatus = (lines) => {
  if (lines.every((l) => (l.qtyReceived || 0) >= l.qty)) return 'RECEIVED';
  if (lines.some((l) => (l.qtyReceived || 0) > 0)) return 'PARTIAL';
  return 'OPEN';
};

module.exports = { lineSubtotal, poTotals, unitCostOf, outstandingOf, receiptStatus };
