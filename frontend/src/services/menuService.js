import axios from 'axios';

const API = '/api/menu';

const getHeaders = (token) => ({
  headers: {
    Authorization: `Bearer ${token}`
  }
});

export const getMenus = async (token) => {
    const res = await axios.get(API, getHeaders(token));
    return res.data;
};

export const getMenuHierarchy = async (token) => {
    const res = await axios.get(`${API}/getHierarchy`, getHeaders(token));
    return res.data;
};

export const getMenuTree = async (token) => {
    const res = await axios.get(`${API}/tree`, getHeaders(token));
    return res.data;
};

export const createMenu = async (data, token) => {
    const res = await axios.post(API, data, getHeaders(token));
    return res.data
};
export const updateMenu = async (id, data, token) => {
    const res = await axios.put(`${API}/${id}`, data, getHeaders(token));
    return res.data;
};
export const deleteMenu = async (id, token) => {
    const res = await axios.delete(`${API}/${id}`, getHeaders(token));
    return res.data;
};
