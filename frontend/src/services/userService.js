import axios from 'axios';

const API = '/api/user';

const getHeaders = (token) => ({
  headers: {
    Authorization: `Bearer ${token}`
  }
});

export const getUsers = async (token, params) => {
  const res = await axios.get(API, { ...getHeaders(token), params });
  return res;
};

export const createUser = async (data, token) => {
  const res = await axios.post(API, data, getHeaders(token));
  return res;
};

export const updateUser = async (id, data, token) => {
  const res = await axios.put(`${API}/${id}`, data, getHeaders(token));
  return res;
};

export const deleteUser = async (id, token) => {
  const res = await axios.delete(`${API}/${id}`, getHeaders(token));
  return res;
};
