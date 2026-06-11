import axios from 'axios';

const API = '/api/vendor';

const getHeaders = (token) => ({
  headers: {
    Authorization: `Bearer ${token}`
  }
});

export const getAllVendor = async (token) => {
  const res = await axios.get(`${API}/all`, getHeaders(token));
  return res;
};

export const getVendor = async (token, params) => {
  const res = await axios.get(API, {
   ...getHeaders(token), 
   params
  });
  return res;
};

export const createVendor = async (data, token) => {
  const res = await axios.post(API, data, getHeaders(token));
  return res;
};

export const updateVendor = async (id, data, token) => {
  const res = await axios.put(`${API}/${id}`, data, getHeaders(token));
  return res;
};

export const deleteVendor = async (id, token) => {
  const res = await axios.delete(`${API}/${id}`, getHeaders(token));
  return res;
};
