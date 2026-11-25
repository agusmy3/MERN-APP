import axios from 'axios';

const CUSTOMER = '/api/customer';
const INV = '/api/sales-invoice';

const getHeaders = (token) => ({
  headers: {
    Authorization: `Bearer ${token}`
  }
});

// ---------- Customer ----------

/** params { search, page, pageSize, sortField, sortOrder } -> { dataCustomer, totalData, ... } */
export const getCustomers = async (token, params) => (await axios.get(CUSTOMER, { ...getHeaders(token), params })).data.data;
/** [{ _id, code, name, isActive, isWalkIn }] (walk-in pertama) */
export const getCustomerDropdown = async (token) => (await axios.get(`${CUSTOMER}/dropdown`, getHeaders(token))).data.data;
export const createCustomer = (data, token) => axios.post(CUSTOMER, data, getHeaders(token));
export const updateCustomer = (id, data, token) => axios.put(`${CUSTOMER}/${id}`, data, getHeaders(token));
export const deleteCustomer = (id, token) => axios.delete(`${CUSTOMER}/${id}`, getHeaders(token));

// ---------- Sales Invoice ----------

/** params { search, status, customer, gudang, from, to, page, pageSize, sortField, sortOrder } */
export const getSalesInvoices = async (token, params) => (await axios.get(INV, { ...getHeaders(token), params })).data.data;
export const getSalesInvoice = async (id, token) => (await axios.get(`${INV}/${id}`, getHeaders(token))).data.data;
/** SKU aktif + saldo gudang + hargaJual (+ avgCost untuk vendorPrice:view) */
export const searchSalesSkus = async (token, params) => (await axios.get(`${INV}/skus`, { ...getHeaders(token), params })).data.data;
/** { gudang, skus: [id] } -> { skuId: qty } */
export const getSalesSkuBalances = async (token, gudang, skus) => (await axios.post(`${INV}/skus/balance`, { gudang, skus }, getHeaders(token))).data.data;
export const createSalesInvoice = (data, token) => axios.post(INV, data, getHeaders(token));
export const updateSalesInvoice = (id, data, token) => axios.put(`${INV}/${id}`, data, getHeaders(token));
export const deleteSalesInvoice = (id, token) => axios.delete(`${INV}/${id}`, getHeaders(token));
export const postSalesInvoice = (id, token) => axios.post(`${INV}/${id}/post`, {}, getHeaders(token));
export const cancelSalesInvoice = (id, reason, token) => axios.post(`${INV}/${id}/cancel`, { reason }, getHeaders(token));
