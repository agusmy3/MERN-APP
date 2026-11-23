import axios from 'axios';

const API = '/api/gudang';

const getHeaders = (token) => ({
  headers: {
    Authorization: `Bearer ${token}`
  }
});

export const getGudang = async (token, params) => {
  const res = await axios.get(API, {
    ...getHeaders(token),
    params
  });
  return res;
};

export const createGudang = async (data, token) => {
  const res = await axios.post(API, data, getHeaders(token));
  return res;
};

export const updateGudang = async (id, data, token) => {
  const res = await axios.put(`${API}/${id}`, data, getHeaders(token));
  return res;
};

export const deleteGudang = async (id, token) => {
  const res = await axios.delete(`${API}/${id}`, getHeaders(token));
  return res;
};

/** Pilihan gudang (cukup login): [{ _id, code, name, isActive }] */
export const getGudangDropdown = async (token) => {
  const res = await axios.get(`${API}/dropdown`, getHeaders(token));
  return res.data.data;
};
