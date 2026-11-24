/**
 * Jenis satuan (UoM.type). Dipakai untuk menolak konversi yang tidak masuk akal di harga vendor,
 * mis. beli per KG (berat) untuk produk bersatuan dasar PCS (hitung): isi per KG tidak pasti.
 *
 * Aturan (canConvert): satuan beli -> satuan dasar boleh jika
 * - salah satu belum diberi jenis (data lama, tidak dicek), atau
 * - jenisnya sama (KG -> G, LTR -> ML, PCS -> PCS), atau
 * - salah satunya KEMASAN (BOX, DUS, SAK...): isinya ditentukan per produk lewat konversi.
 * Salinan frontend: utils/uomMeta.js
 */
const UOM_TYPES = {
  COUNT: 'Count',
  WEIGHT: 'Weight',
  VOLUME: 'Volume',
  LENGTH: 'Length',
  PACK: 'Package',
};

const canConvert = (purchaseType, baseType) => !purchaseType || !baseType
  || purchaseType === baseType || purchaseType === 'PACK' || baseType === 'PACK';

// tebakan jenis dari kode untuk UoM lama (migrate:uom-type); kode lain diisi manual di menu UoM
const GUESS = {
  COUNT: ['PCS', 'PC', 'UNIT', 'UNT', 'EA', 'BUAH', 'BH', 'BIJI', 'LEMBAR', 'LBR', 'BATANG', 'BTG', 'EKOR', 'ORANG', 'PASANG', 'PSG', 'PAIR'],
  WEIGHT: ['KG', 'G', 'GR', 'GRAM', 'MG', 'TON', 'ONS', 'KWINTAL', 'LB'],
  VOLUME: ['L', 'LT', 'LTR', 'LITER', 'ML', 'CC', 'M3'],
  LENGTH: ['M', 'MTR', 'METER', 'CM', 'MM', 'KM', 'INCH', 'YARD', 'YD'],
  PACK: ['BOX', 'DUS', 'KARTON', 'CTN', 'PACK', 'PAK', 'PCK', 'SAK', 'KARUNG', 'BAL', 'BALL', 'KRAT', 'TRAY', 'ROLL', 'RIM', 'LUSIN', 'KODI', 'GROSS', 'SET', 'BOTOL', 'BTL', 'KALENG', 'GALON', 'JERIGEN', 'DRUM', 'PAIL', 'BUNDLE', 'IKAT', 'TUBE', 'SACHET'],
};
const guessType = (code) => Object.keys(GUESS).find((t) => GUESS[t].includes(String(code || '').toUpperCase())) || null;

module.exports = { UOM_TYPES, canConvert, guessType };
