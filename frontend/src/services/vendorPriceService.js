import axios from 'axios';

const API = '/api/vendor-price';

const getHeaders = (token) => ({
  headers: {
    Authorization: `Bearer ${token}`
  }
});

/** params: { produk } atau { vendor }. Tiap baris punya hargaPerUnit (per satuan dasar produk). */
export const getVendorPrices = async (token, params) => {
  const res = await axios.get(API, { ...getHeaders(token), params });
  return res.data.data;
};

/** data: { vendor, skus: [skuId, ...], uomBeli, konversi, hargaBeli, isPreferred, minOrder, catatan } */
export const createVendorPrice = async (data, token) => {
  const res = await axios.post(API, data, getHeaders(token));
  return res;
};

export const updateVendorPrice = async (id, data, token) => {
  const res = await axios.put(`${API}/${id}`, data, getHeaders(token));
  return res;
};

export const deleteVendorPrice = async (id, token) => {
  const res = await axios.delete(`${API}/${id}`, getHeaders(token));
  return res;
};
