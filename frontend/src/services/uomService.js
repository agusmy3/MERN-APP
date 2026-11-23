import axios from 'axios';

const API = '/api/uom';

const getHeaders = (token) => ({
  headers: {
    Authorization: `Bearer ${token}`
  }
});

export const getAllUom = async (token) => {
  const res = await axios.get(`${API}/all`, getHeaders(token));
  return res;
};

export const getUom = async (token, params) => {
  const res = await axios.get(API, {
    ...getHeaders(token),
    params
  });
  return res;
};

export const createUom = async (data, token) => {
  const res = await axios.post(API, data, getHeaders(token));
  return res;
};

export const updateUom = async (id, data, token) => {
  const res = await axios.put(`${API}/${id}`, data, getHeaders(token));
  return res;
};

export const deleteUom = async (id, token) => {
  const res = await axios.delete(`${API}/${id}`, getHeaders(token));
  return res;
};

/** Pilihan untuk form lain (cukup login): [{ _id, code, name }] */
export const getUomDropdown = async (token) => {
  const res = await axios.get(`${API}/dropdown`, getHeaders(token));
  return res.data.data;
};
