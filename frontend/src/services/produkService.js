import axios from 'axios';

const API = '/api/produk';

const getHeaders = (token) => ({
  headers: {
    Authorization: `Bearer ${token}`
  }
});

export const getAllProduk = async (token) => {
  const res = await axios.get(API, getHeaders(token));
  return res.data;
};

export const createProduk = async (data, token) => {
  const res = await axios.post(API, data, getHeaders(token));
  return res.data;
};

export const updateProduk = async (id, data, token) => {
  const res = await axios.put(`${API}/${id}`, data, getHeaders(token));
  return res.data;
};

export const deleteProduk = async (id, token) => {
  const res = await axios.delete(`${API}/${id}`, getHeaders(token));
  return res.data;
};
