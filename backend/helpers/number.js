/**
 * Angka desimal: jumlah stok, harga, konversi, dll. maks. 2 angka di belakang koma.
 * Disimpan sebagai Number biasa; setiap hasil hitung dibulatkan dengan round2 supaya
 * tidak menumpuk galat floating point (mis. 0.1 + 0.2 = 0.30000000000000004).
 */
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const hasMax2Decimals = (n) => Math.abs(round2(n) - n) < 1e-9;

/**
 * Validasi 1 nilai angka. Return pesan error atau null.
 *   checkAmount(req.body.hargaJual, 'Selling price')                 // >= 0
 *   checkAmount(qty, 'Quantity', { min: 0, exclusive: true })        // > 0
 *   checkAmount(qty, 'Quantity', { min: null, nonZero: true })       // boleh negatif, bukan 0
 */
const checkAmount = (value, label, { min = 0, exclusive = false, nonZero = false } = {}) => {
  if (value === null || value === undefined || value === '') return `${label} is required`;
  const n = Number(value);
  if (!Number.isFinite(n)) return `${label} must be a number`;
  if (!hasMax2Decimals(n)) return `${label} can have at most 2 decimal places`;
  if (min !== null && (exclusive ? n <= min : n < min)) return `${label} must be ${exclusive ? '>' : '>='} ${min}`;
  if (nonZero && n === 0) return `${label} cannot be 0`;
  return null;
};

module.exports = { round2, hasMax2Decimals, checkAmount };
