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

// ---------- Sales Return ----------

const RTN = '/api/sales-return';
/** params { search, status, customer, salesInvoice, gudang, from, to, page, pageSize, sortField, sortOrder } */
export const getSalesReturns = async (token, params) => (await axios.get(RTN, { ...getHeaders(token), params })).data.data;
export const getSalesReturn = async (id, token) => (await axios.get(`${RTN}/${id}`, getHeaders(token))).data.data;
/** invoice POSTED yang masih bisa diretur: [{ _id, no, date, total, customer, gudang }] */
export const getReturnInvoiceOptions = async (token, search) => (await axios.get(`${RTN}/invoice-options`, { ...getHeaders(token), params: { search } })).data.data;
/** invoice + baris (returnable, unitAmount) */
export const getInvoiceForReturn = async (invoiceId, token) => (await axios.get(`${RTN}/from-invoice/${invoiceId}`, getHeaders(token))).data.data;
export const createSalesReturn = (data, token) => axios.post(RTN, data, getHeaders(token));
export const updateSalesReturn = (id, data, token) => axios.put(`${RTN}/${id}`, data, getHeaders(token));
export const deleteSalesReturn = (id, token) => axios.delete(`${RTN}/${id}`, getHeaders(token));
export const postSalesReturn = (id, token) => axios.post(`${RTN}/${id}/post`, {}, getHeaders(token));
export const cancelSalesReturn = (id, reason, token) => axios.post(`${RTN}/${id}/cancel`, { reason }, getHeaders(token));

// ---------- Sales Payment ----------

const PAY = '/api/sales-payment';
/** params { search, status, type, method, customer, salesInvoice, gudang, from, to, page, pageSize, sortField, sortOrder } */
export const getSalesPayments = async (token, params) => (await axios.get(PAY, { ...getHeaders(token), params })).data.data;
/** { salesInvoice, type: PAYMENT|REFUND, date, method, amount, reference, note } */
export const createSalesPayment = (data, token) => axios.post(PAY, data, getHeaders(token));
export const cancelSalesPayment = (id, reason, token) => axios.post(`${PAY}/${id}/cancel`, { reason }, getHeaders(token));

// ---------- Price List ----------

const PL = '/api/price-list';
export const getPriceLists = async (token, params) => (await axios.get(PL, { ...getHeaders(token), params })).data.data;
export const getPriceList = async (id, token) => (await axios.get(`${PL}/${id}`, getHeaders(token))).data.data;
/** [{ _id, code, name, isActive }] */
export const getPriceListDropdown = async (token) => (await axios.get(`${PL}/dropdown`, getHeaders(token))).data.data;
/** params { search } | { produk } | { kategori } -> SKU + hargaJual (+ avgCost) */
export const searchPriceListSkus = async (token, params) => (await axios.get(`${PL}/skus`, { ...getHeaders(token), params })).data.data;
export const createPriceList = (data, token) => axios.post(PL, data, getHeaders(token));
export const updatePriceList = (id, data, token) => axios.put(`${PL}/${id}`, data, getHeaders(token));
export const deletePriceList = (id, token) => axios.delete(`${PL}/${id}`, getHeaders(token));
/** harga jual untuk customer: { skuId: { price, source: list|default } } */
export const getSalesSkuPrices = async (token, customer, skus) => (await axios.post(`${INV}/skus/prices`, { customer, skus }, getHeaders(token))).data.data;

// ---------- Sales Report ----------

/** params { from, to, groupBy: day|month|customer|produk|kategori|sku, gudang, customer, tz } -> { rows, totals, canSeeCost } */
export const getSalesReport = async (token, params) => (await axios.get('/api/sales-report/sales', { ...getHeaders(token), params })).data.data;
/** params { gudang, customer } -> { asOf, rows: [{ customer, current, d1_30, d31_60, d61_90, d90, total, invoices }], totals } */
export const getAgingReport = async (token, params) => (await axios.get('/api/sales-report/aging', { ...getHeaders(token), params })).data.data;
