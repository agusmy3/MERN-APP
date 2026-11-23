import axios from 'axios';

const API = '/api/role';

const getHeaders = (token) => ({
  headers: {
    Authorization: `Bearer ${token}`
  }
});

export const getRoles = async (token, params) => {
  const res = await axios.get(API, { ...getHeaders(token), params });
  return res;
};

/** Daftar resource & action untuk matriks izin: { resources: [{ key, label, group }], actions: [...] } */
export const getRoleResources = async (token) => {
  const res = await axios.get(`${API}/resources`, getHeaders(token));
  return res.data.data;
};

/** Pilihan role untuk form User (cukup login): [{ _id, name }] */
export const getRoleDropdown = async (token) => {
  const res = await axios.get(`${API}/dropdown`, getHeaders(token));
  return res.data.data;
};

export const createRole = async (data, token) => {
  const res = await axios.post(API, data, getHeaders(token));
  return res;
};

export const updateRole = async (id, data, token) => {
  const res = await axios.put(`${API}/${id}`, data, getHeaders(token));
  return res;
};

export const deleteRole = async (id, token) => {
  const res = await axios.delete(`${API}/${id}`, getHeaders(token));
  return res;
};
