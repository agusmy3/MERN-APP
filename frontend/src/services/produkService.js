import axios from 'axios';

const API = '/api/produk';

const getHeaders = (token) => ({
  headers: {
    Authorization: `Bearer ${token}`
  }
});

export const getAllProduk = async (token) => {
  const res = await axios.get(`${API}/all`, getHeaders(token));
  return res;
};

export const getProduk = async (token, params) => {
  const res = await axios.get(API, {
    ...getHeaders(token),
    params
  });
  return res;
};

export const createProduk = async (data, token) => {
  const res = await axios.post(API, data, getHeaders(token));
  return res;
};

export const updateProduk = async (id, data, token) => {
  const res = await axios.put(`${API}/${id}`, data, getHeaders(token));
  return res;
};

export const deleteProduk = async (id, token) => {
  const res = await axios.delete(`${API}/${id}`, getHeaders(token));
  return res;
};

/** Detail 1 produk: kategori, uom, variants (dengan values), ringkasan SKU */
export const getProdukById = async (id, token) => {
  const res = await axios.get(`${API}/${id}`, getHeaders(token));
  return res.data.data;
};

// ---- SKU (varian produk) ----

/** -> { skus: [...], canSeeCost } (harga pokok hanya jika boleh lihat harga vendor) */
export const getProdukSkus = async (produkId, token) => {
  const res = await axios.get(`${API}/${produkId}/sku`, getHeaders(token));
  return res.data.data;
};

/** selections: { <variantId>: ['Merah', 'Biru'], ... } */
export const generateProdukSkus = async (produkId, selections, token) => {
  const res = await axios.post(`${API}/${produkId}/sku/generate`, { selections }, getHeaders(token));
  return res;
};

/** skus: [{ _id, sku, hargaJual, stok, isActive }] */
export const updateProdukSkus = async (produkId, skus, token) => {
  const res = await axios.put(`${API}/${produkId}/sku`, { skus }, getHeaders(token));
  return res;
};

export const deleteProdukSku = async (produkId, skuId, token) => {
  const res = await axios.delete(`${API}/${produkId}/sku/${skuId}`, getHeaders(token));
  return res;
};
