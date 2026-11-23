import axios from 'axios';

const API = '/api/variant';

const getHeaders = (token) => ({
  headers: {
    Authorization: `Bearer ${token}`
  }
});

export const getAllVariant = async (token) => {
  const res = await axios.get(`${API}/all`, getHeaders(token));
  return res;
};

export const getVariant = async (token, params) => {
  const res = await axios.get(API, {
    ...getHeaders(token),
    params
  });
  return res;
};

export const createVariant = async (data, token) => {
  const res = await axios.post(API, data, getHeaders(token));
  return res;
};

export const updateVariant = async (id, data, token) => {
  const res = await axios.put(`${API}/${id}`, data, getHeaders(token));
  return res;
};

export const deleteVariant = async (id, token) => {
  const res = await axios.delete(`${API}/${id}`, getHeaders(token));
  return res;
};

/** Pilihan untuk form lain (cukup login): [{ _id, code, name }] */
export const getVariantDropdown = async (token) => {
  const res = await axios.get(`${API}/dropdown`, getHeaders(token));
  return res.data.data;
};
