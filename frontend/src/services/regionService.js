import axios from 'axios';

/** Master wilayah (data referensi, cukup login). Daftar anak per parent di-cache selama aplikasi terbuka. */
const API = '/api/region';
const headers = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
const childCache = new Map();

/** Anak wilayah (parent kosong = provinsi) -> Promise<[{ kode, name, level, parent, kodePos? }]> */
export const getRegionChildren = (token, parent = '') => {
  const key = parent || '';
  if (!childCache.has(key)) {
    const p = axios.get(API, { ...headers(token), params: key ? { parent: key } : {} })
      .then((res) => res.data.data)
      .catch((err) => { childCache.delete(key); throw err; });
    childCache.set(key, p);
  }
  return childCache.get(key);
};

/** Cari nama wilayah di semua tingkat (min. 3 huruf) -> [{ kode, name, level, path, kodePos? }] */
export const searchRegions = async (token, q, params = {}) => {
  const res = await axios.get(`${API}/search`, { ...headers(token), params: { q, ...params } });
  return res.data.data;
};

/** Detail + path (provinsi s/d wilayah) + center */
export const getRegion = async (token, kode) => {
  const res = await axios.get(`${API}/${encodeURIComponent(kode)}`, headers(token));
  return res.data.data;
};
