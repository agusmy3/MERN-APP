/** 12500 -> "Rp 12.500" (tanpa desimal; nilai kosong -> "-") */
export const formatRupiah = (value) => {
  if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) return '-';
  const n = Number(value);
  // harga per satuan hasil pembagian bisa berdesimal (mis. 4.166,67), tampilkan maks. 2 desimal
  return n.toLocaleString('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
  });
};

/** Rentang harga: "Rp 10.000" atau "Rp 10.000 – Rp 15.000" */
export const formatRupiahRange = (min, max) => {
  if (min === null || min === undefined) return '-';
  return min === max ? formatRupiah(min) : `${formatRupiah(min)} – ${formatRupiah(max)}`;
};

export const formatNumber = (value) => Number(value || 0).toLocaleString('id-ID');

/** Margin kotor terhadap harga jual: (jual - pokok) / jual. null jika tidak bisa dihitung. */
export const calcMargin = (hargaJual, hargaPokok) => {
  const jual = Number(hargaJual);
  if (hargaPokok === null || hargaPokok === undefined || !jual) return null;
  return ((jual - Number(hargaPokok)) / jual) * 100;
};

/** Label kombinasi varian SKU: "Merah / M" ("Default" untuk produk tanpa varian) */
export const variantLabel = (sku) =>
  (sku?.variantValues || []).map((v) => v.value).join(' / ') || 'Default';
