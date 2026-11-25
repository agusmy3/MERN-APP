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

// ---------- POS fase 2 ----------
/** supervisor yang bisa menyetujui (PIN) di outlet shift ini: [{ _id, name }] */
export const getApprovers = async (token) => (await axios.get(`${POS}/approvers`, getHeaders(token))).data.data;
export const getHolds = async (token) => (await axios.get(`${POS}/holds`, getHeaders(token))).data.data;
/** { customer, lines: [{ sku, qty, diskonPersen }], discountAmount, note } */
export const createHold = (data, token) => axios.post(`${POS}/holds`, data, getHeaders(token));
/** -> { customer, discountAmount, note, lines (siap keranjang), skipped } ; hold dihapus */
export const resumeHold = async (id, token) => (await axios.post(`${POS}/holds/${id}/resume`, {}, getHeaders(token))).data.data;
export const deleteHold = (id, token) => axios.delete(`${POS}/holds/${id}`, getHeaders(token));
/** transaksi POS di outlet shift ini: + lines (returnable, unitAmount), payments, canVoid, canReturn */
export const lookupPosSale = async (no, token) => (await axios.get(`${POS}/sales/lookup`, { ...getHeaders(token), params: { no } })).data.data;
/** { reason, approver, pin } */
export const voidPosSale = (id, data, token) => axios.post(`${POS}/sales/${id}/void`, data, getHeaders(token));
/** { salesInvoice, lines: [{ sku, qty }], reason, refundMethod, reference, approver, pin } */
export const createPosReturn = (data, token) => axios.post(`${POS}/returns`, data, getHeaders(token));
/** params { from, to, outlet, cashier } -> { rows, totals } */
export const getCashierReport = async (token, params) => (await axios.get(`${SHIFT}/report`, { ...getHeaders(token), params })).data.data;
