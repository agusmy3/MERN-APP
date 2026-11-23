import axios from 'axios';

const PO = '/api/purchase-order';
const GR = '/api/goods-receipt';
const SETTING = '/api/setting';

const getHeaders = (token) => ({
  headers: {
    Authorization: `Bearer ${token}`
  }
});

// ---------- System Settings ----------

/** -> { definitions: [{ key, label, group, type, description, ... }], values: { key: value } } */
export const getSettings = async (token) => (await axios.get(SETTING, getHeaders(token))).data.data;
export const updateSettings = (values, token) => axios.put(SETTING, { values }, getHeaders(token));

// ---------- Purchase Order ----------

/** params { search, status (ACTIVE = OPEN+PARTIAL), vendor, gudang, from, to, page, pageSize, sortField, sortOrder } */
export const getPurchaseOrders = async (token, params) => (await axios.get(PO, { ...getHeaders(token), params })).data.data;
export const getPurchaseOrder = async (id, token) => (await axios.get(`${PO}/${id}`, getHeaders(token))).data.data;
/** SKU + pilihan harga vendor: [{ _id, sku, variant, produk, baseUom, prices: [{ uomBeli, konversi, hargaBeli, minOrder, isPreferred }] }] */
export const searchPoItems = async (token, params) => (await axios.get(`${PO}/items`, { ...getHeaders(token), params })).data.data;
export const createPurchaseOrder = (data, token) => axios.post(PO, data, getHeaders(token));
export const updatePurchaseOrder = (id, data, token) => axios.put(`${PO}/${id}`, data, getHeaders(token));
export const deletePurchaseOrder = (id, token) => axios.delete(`${PO}/${id}`, getHeaders(token));
export const issuePurchaseOrder = (id, token) => axios.post(`${PO}/${id}/issue`, {}, getHeaders(token));
export const cancelPurchaseOrder = (id, reason, token) => axios.post(`${PO}/${id}/cancel`, { reason }, getHeaders(token));
export const closePurchaseOrder = (id, reason, token) => axios.post(`${PO}/${id}/close`, { reason }, getHeaders(token));

// ---------- Goods Receipt ----------

export const getGoodsReceipts = async (token, params) => (await axios.get(GR, { ...getHeaders(token), params })).data.data;
export const getGoodsReceipt = async (id, token) => (await axios.get(`${GR}/${id}`, getHeaders(token))).data.data;
/** PO yang bisa diterima (OPEN / PARTIAL) */
export const getReceivablePos = async (token, search) => (await axios.get(`${GR}/po-options`, { ...getHeaders(token), params: { search } })).data.data;
/** PO + baris & sisanya untuk mengisi GR */
export const getPoForReceipt = async (poId, token) => (await axios.get(`${GR}/from-po/${poId}`, getHeaders(token))).data.data;
export const createGoodsReceipt = (data, token) => axios.post(GR, data, getHeaders(token));
export const updateGoodsReceipt = (id, data, token) => axios.put(`${GR}/${id}`, data, getHeaders(token));
export const deleteGoodsReceipt = (id, token) => axios.delete(`${GR}/${id}`, getHeaders(token));
export const postGoodsReceipt = (id, updateVendorPrice, token) => axios.post(`${GR}/${id}/post`, { updateVendorPrice }, getHeaders(token));
export const cancelGoodsReceipt = (id, reason, token) => axios.post(`${GR}/${id}/cancel`, { reason }, getHeaders(token));
