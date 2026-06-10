import axios from 'axios';

const API = '/api/kategori';

const getHeaders = (token) => ({
  headers: {
    Authorization: `Bearer ${token}`
  }
});

export const getAllKategori = async (token) => {
  const res = await axios.get(API, getHeaders(token));
  return res.data;
};

export const getKategori = async (token, params) => {
  const res = await axios.get(API, {
   ...getHeaders(token), 
   params
  });
  return res;
};

export const createKategori = async (data, token) => {
  const res = await axios.post(API, data, getHeaders(token));
  return res.data;
};

export const updateKategori = async (id, data, token) => {
  const res = await axios.put(`${API}/${id}`, data, getHeaders(token));
  return res.data;
};

export const deleteKategori = async (id, token) => {
  const res = await axios.delete(`${API}/${id}`, getHeaders(token));
  return res.data;
};
