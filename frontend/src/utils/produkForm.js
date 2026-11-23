export const EMPTY_PRODUK_FORM = {
  name: '',
  kategori: '',
  uom: '',
  variants: [], // id jenis varian, mis. [COLOR, SIZE]
  deskripsi: '',
};

/** baris produk (dari API) -> nilai form ProdukFormFields */
export const produkToForm = (row) => ({
  name: row.name,
  kategori: row.kategori?._id || '',
  uom: row.uom?._id || '',
  variants: (row.variants || []).map((v) => v._id || v),
  deskripsi: row.deskripsi || '',
});
