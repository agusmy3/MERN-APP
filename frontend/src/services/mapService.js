import axios from 'axios';

const headers = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

/** Titik peta per lapisan yang boleh dilihat -> { layers: { outlet|gudang|vendor|customer: { points, missing } } } */
export const getMapPoints = async (token, params = {}) => (await axios.get('/api/map/points', { ...headers(token), params })).data.data;

/** Ringkasan 1 lokasi (angka sesuai izin) -> { title, subtitle, items: [{ label, value, format, tone }] } */
export const getMapSummary = async (token, type, id) => (await axios.get(`/api/map/summary/${type}/${id}`, {
  ...headers(token),
  params: { tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
})).data.data;
