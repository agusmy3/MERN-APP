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

// ---------- Vendor Bill (hutang) ----------

const BILL = '/api/purchase-invoice';
/** params { search, status, paymentStatus (OPEN|OVERDUE|...), vendor, from, to, paginasi } -> { dataPurchaseInvoice, totalData } */
export const getVendorBills = async (token, params) => (await axios.get(BILL, { ...getHeaders(token), params })).data.data;
export const getVendorBill = async (id, token) => (await axios.get(`${BILL}/${id}`, getHeaders(token))).data.data;
/** -> { vendor, goods: [{ _id, no, date, gudang, purchaseOrder, taxRate, amount, hasDraftReturn }], freight: [{ _id, no, amount, supplier }] } */
export const getBillable = async (vendor, token) => (await axios.get(`${BILL}/billable`, { ...getHeaders(token), params: { vendor } })).data.data;
export const getPayablesAging = async (token, params) => (await axios.get(`${BILL}/aging`, { ...getHeaders(token), params })).data.data;
/** { vendor, goodsReceipts: [id], freightReceipts: [id], vendorInvoiceNo, date, dueDate, note } */
export const createVendorBill = (data, token) => axios.post(BILL, data, getHeaders(token));
export const cancelVendorBill = (id, reason, token) => axios.post(`${BILL}/${id}/cancel`, { reason }, getHeaders(token));

// ---------- Vendor Payment ----------

const VPAY = '/api/vendor-payment';
export const getVendorPayments = async (token, params) => (await axios.get(VPAY, { ...getHeaders(token), params })).data.data;
/** { purchaseInvoice, type (PAYMENT|REFUND), date, method, amount, reference, note } */
export const createVendorPayment = (data, token) => axios.post(VPAY, data, getHeaders(token));
export const cancelVendorPayment = (id, reason, token) => axios.post(`${VPAY}/${id}/cancel`, { reason }, getHeaders(token));

// ---------- Purchase Return ----------

const PRT = '/api/purchase-return';
export const getPurchaseReturns = async (token, params) => (await axios.get(PRT, { ...getHeaders(token), params })).data.data;
export const getPurchaseReturn = async (id, token) => (await axios.get(`${PRT}/${id}`, getHeaders(token))).data.data;
export const getReturnableGrs = async (token, search) => (await axios.get(`${PRT}/gr-options`, { ...getHeaders(token), params: { search } })).data.data;
export const getGrForReturn = async (grId, token) => (await axios.get(`${PRT}/from-gr/${grId}`, getHeaders(token))).data.data;
export const createPurchaseReturn = (data, token) => axios.post(PRT, data, getHeaders(token));
export const updatePurchaseReturn = (id, data, token) => axios.put(`${PRT}/${id}`, data, getHeaders(token));
export const deletePurchaseReturn = (id, token) => axios.delete(`${PRT}/${id}`, getHeaders(token));
export const postPurchaseReturn = (id, token) => axios.post(`${PRT}/${id}/post`, {}, getHeaders(token));
export const cancelPurchaseReturn = (id, reason, token) => axios.post(`${PRT}/${id}/cancel`, { reason }, getHeaders(token));

// ---------- Vendor Payment Batch (pembayaran gabungan beberapa tagihan) ----------

const VPB = '/api/vendor-payment-batch';
export const getVendorPaymentBatches = async (token, params) => (await axios.get(VPB, { ...getHeaders(token), params })).data.data;
export const getVendorPaymentBatch = async (id, token) => (await axios.get(`${VPB}/${id}`, getHeaders(token))).data.data;
export const getVendorOpenBills = async (vendor, token) => (await axios.get(`${VPB}/open-invoices`, { ...getHeaders(token), params: { vendor } })).data.data;
/** { vendor, date, method, amount, reference, note, allocations: [{ invoice, amount }] } */
export const createVendorPaymentBatch = (data, token) => axios.post(VPB, data, getHeaders(token));
export const cancelVendorPaymentBatch = (id, reason, token) => axios.post(`${VPB}/${id}/cancel`, { reason }, getHeaders(token));

// ---------- Vendor Deposit (uang muka ke vendor) ----------

const VDP = '/api/vendor-deposit';
export const getVendorDeposits = async (token, params) => (await axios.get(VDP, { ...getHeaders(token), params })).data.data;
export const getVendorDeposit = async (id, token) => (await axios.get(`${VDP}/${id}`, getHeaders(token))).data.data;
export const getOpenVendorDeposits = async (vendor, token) => (await axios.get(`${VDP}/open`, { ...getHeaders(token), params: { vendor } })).data.data;
export const createVendorDeposit = (data, token) => axios.post(VDP, data, getHeaders(token));
export const vendorDepositFromInvoice = (data, token) => axios.post(`${VDP}/from-invoice`, data, getHeaders(token));
export const applyVendorDeposit = (id, data, token) => axios.post(`${VDP}/${id}/apply`, data, getHeaders(token));
export const refundVendorDeposit = (id, data, token) => axios.post(`${VDP}/${id}/refund`, data, getHeaders(token));
export const cancelVendorDepositRefund = (id, refundId, reason, token) => axios.post(`${VDP}/${id}/refunds/${refundId}/cancel`, { reason }, getHeaders(token));
export const cancelVendorDeposit = (id, reason, token) => axios.post(`${VDP}/${id}/cancel`, { reason }, getHeaders(token));
