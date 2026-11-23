import axios from 'axios';

const authHeader = (token) => ({ headers: { Authorization: `Bearer ${token}` } });

// Registrasi publik dimatikan: user dibuat admin lewat menu User.

/** -> { _id, name, email, theme, role, permissions, token } */
export const loginUser = async (data) => {
  const res = await axios.post('/api/auth/login', data);
  return res.data.data;
};

/** Profil & izin terbaru (tanpa token) */
export const getMe = async (token) => {
  const res = await axios.get('/api/auth/me', authHeader(token));
  return res.data.data;
};

export const updateTheme = async (theme, token) => {
  const res = await axios.put('/api/auth/theme', { theme }, authHeader(token));
  return res;
};
