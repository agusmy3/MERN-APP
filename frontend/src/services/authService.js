import axios from 'axios';

export const loginUser = async (data) => {
  const res = await axios.post('/api/auth/login', data);
  return res.data;
};

export const registerUser = async (data) => {
  const res = await axios.post('/api/auth/register', data);
  return res.data;
};