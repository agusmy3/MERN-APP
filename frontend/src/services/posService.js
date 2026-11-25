import axios from 'axios';

const OUTLET = '/api/outlet';
const POS = '/api/pos';
const SHIFT = '/api/pos-shift';

const getHeaders = (token) => ({
  headers: {
    Authorization: `Bearer ${token}`
  }
});

// ---------- Outlet ----------
export const getOutlets = async (token, params) => (await axios.get(OUTLET, { ...getHeaders(token), params })).data.data;
/** [{ _id, code, name, isActive, gudang, assigned }] */
export const getOutletDropdown = async (token) => (await axios.get(`${OUTLET}/dropdown`, getHeaders(token))).data.data;
export const createOutlet = (data, token) => axios.post(OUTLET, data, getHeaders(token));
export const updateOutlet = (id, data, token) => axios.put(`${OUTLET}/${id}`, data, getHeaders(token));
export const deleteOutlet = (id, token) => axios.delete(`${OUTLET}/${id}`, getHeaders(token));

// ---------- Layar kasir ----------
/** { outlets, shift (+ summary, recent) | null, walkIn, taxRate } */
export const getPosContext = async (token) => (await axios.get(`${POS}/context`, getHeaders(token))).data.data;
/** params { search, customer } -> [{ _id, sku, barcode, exact, variant, produk, uom, qty, price, priceSource }] */
export const searchPosSkus = async (token, params) => (await axios.get(`${POS}/skus`, { ...getHeaders(token), params })).data.data;
export const openShift = (data, token) => axios.post(`${POS}/shift/open`, data, getHeaders(token));
export const cashMove = (data, token) => axios.post(`${POS}/shift/cash`, data, getHeaders(token));
export const closeShift = (data, token) => axios.post(`${POS}/shift/close`, data, getHeaders(token));
/** { customer?, lines: [{ sku, qty, diskonPersen }], discountAmount, payments: [{ method, amount, reference }], note } */
export const createPosSale = (data, token) => axios.post(`${POS}/sales`, data, getHeaders(token));
export const getPosReceipt = async (id, token) => (await axios.get(`${POS}/sales/${id}/receipt`, getHeaders(token))).data.data;

// ---------- Shift (supervisor) ----------
export const getShifts = async (token, params) => (await axios.get(SHIFT, { ...getHeaders(token), params })).data.data;
export const getShift = async (id, token) => (await axios.get(`${SHIFT}/${id}`, getHeaders(token))).data.data;
export const forceCloseShift = (id, data, token) => axios.post(`${SHIFT}/${id}/close`, data, getHeaders(token));
export const getPosPrices = async (token, customer, skus) => (await axios.post(`${POS}/prices`, { customer, skus }, getHeaders(token))).data.data;
