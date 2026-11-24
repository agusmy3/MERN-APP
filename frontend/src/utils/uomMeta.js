/**
 * Jenis satuan (salinan backend/config/uom.js). Satuan beli boleh dikonversi ke satuan dasar jika
 * jenisnya sama, salah satunya Kemasan, atau salah satunya belum diberi jenis (data lama).
 */
export const UOM_TYPES = {
  COUNT: { label: 'Count', hint: 'dihitung per buah: PCS, UNIT, LEMBAR' },
  WEIGHT: { label: 'Weight', hint: 'berat: KG, GRAM, TON' },
  VOLUME: { label: 'Volume', hint: 'isi: LITER, ML' },
  LENGTH: { label: 'Length', hint: 'panjang: METER, CM' },
  PACK: { label: 'Package', hint: 'kemasan, isinya ditentukan per produk: BOX, DUS, SAK, LUSIN' },
};

export const canConvert = (purchaseType, baseType) => !purchaseType || !baseType
  || purchaseType === baseType || purchaseType === 'PACK' || baseType === 'PACK';

export const uomTypeLabel = (type) => UOM_TYPES[type]?.label || '';
