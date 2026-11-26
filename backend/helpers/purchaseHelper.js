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

/**
 * Biaya angkut penerimaan dibagi ke baris menurut nilai barang (qtyBase x HPP harga), atau qty jika semua
 * bernilai 0. Baris terakhir menerima sisa pembulatan (jumlah freightCost = freight).
 * lines: [{ qtyBase, baseUnitCost }] -> lines + { freightCost, unitCost } (unitCost = base + angkut per satuan dasar)
 */
const allocateFreight = (lines, freight) => {
  const total = round2(Math.max(Number(freight) || 0, 0));
  const weights = lines.map((l) => l.qtyBase * (l.baseUnitCost || 0));
  const sum = weights.reduce((a, b) => a + b, 0);
  const basis = sum > 0 ? weights : lines.map((l) => l.qtyBase);
  const basisSum = basis.reduce((a, b) => a + b, 0);
  let left = total;
  return lines.map((l, i) => {
    const share = i === lines.length - 1 ? left : round2(basisSum ? total * (basis[i] / basisSum) : 0);
    left = round2(left - share);
    const freightCost = total ? share : 0;
    return { ...l, freightCost, unitCost: round2((l.baseUnitCost || 0) + (l.qtyBase ? freightCost / l.qtyBase : 0)) };
  });
};

/** Sisa yang belum diterima (dalam satuan beli) */
const outstandingOf = (line) => Math.max(round2(line.qty - (line.qtyReceived || 0)), 0);

/** Status PO dari penerimaan barisnya (dipakai saat GR di-post / dibatalkan) */
const receiptStatus = (lines) => {
  if (lines.every((l) => (l.qtyReceived || 0) >= l.qty)) return 'RECEIVED';
  if (lines.some((l) => (l.qtyReceived || 0) > 0)) return 'PARTIAL';
  return 'OPEN';
};

module.exports = { lineSubtotal, poTotals, unitCostOf, allocateFreight, outstandingOf, receiptStatus };
