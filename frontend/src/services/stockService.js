import axios from 'axios';

const ADJ = '/api/stock-adjustment';
const MOV = '/api/stock-movement';

const getHeaders = (token) => ({
  headers: {
    Authorization: `Bearer ${token}`
  }
});

// ---------- Stock Adjustment ----------

/** Daftar dokumen: params { search, status, type, gudang, from, to, page, pageSize, sortField, sortOrder } */
export const getStockAdjustments = async (token, params) => {
  const res = await axios.get(ADJ, { ...getHeaders(token), params });
  return res.data.data;
};

export const getStockAdjustment = async (id, token) => {
  const res = await axios.get(`${ADJ}/${id}`, getHeaders(token));
  return res.data.data;
};

export const createStockAdjustment = (data, token) => axios.post(ADJ, data, getHeaders(token));
export const updateStockAdjustment = (id, data, token) => axios.put(`${ADJ}/${id}`, data, getHeaders(token));
export const deleteStockAdjustment = (id, token) => axios.delete(`${ADJ}/${id}`, getHeaders(token));
export const postStockAdjustment = (id, token) => axios.post(`${ADJ}/${id}/post`, {}, getHeaders(token));
export const cancelStockAdjustment = (id, reason, token) => axios.post(`${ADJ}/${id}/cancel`, { reason }, getHeaders(token));

/**
 * Cari SKU untuk baris dokumen: params { gudang, search } (maks. 20) atau { gudang, produk | kategori } (semua).
 * -> [{ _id, sku, isActive, variant, produk: { _id, name }, uom, qty }]
 */
export const searchStockSkus = async (token, params) => {
  const res = await axios.get(`${ADJ}/skus`, { ...getHeaders(token), params });
  return res.data.data;
};

/** Saldo SKU di 1 gudang -> { <skuId>: qty } */
export const getSkuBalances = async (token, gudang, skus) => {
  const res = await axios.post(`${ADJ}/skus/balance`, { gudang, skus }, getHeaders(token));
  return res.data.data;
};

// ---------- Stock Movement ----------

/** Kartu stok: params { produk, sku, gudang, type, from, to, search, page, pageSize, sortOrder } */
export const getStockMovements = async (token, params) => {
  const res = await axios.get(MOV, { ...getHeaders(token), params });
  return res.data.data;
};

/** Saldo per SKU per gudang untuk 1 produk -> [{ sku, gudang: { _id, code, name, isActive }, qty }] */
export const getStockBalances = async (token, produk) => {
  const res = await axios.get(`${MOV}/balance`, { ...getHeaders(token), params: { produk } });
  return res.data.data;
};

// ---------- Stock Valuation (izin vendorPrice:view) ----------

/** params { groupBy: sku|produk|kategori|gudang, gudang, kategori, search } -> { groupBy, rows, totals } */
export const getStockValuation = async (token, params) => {
  const res = await axios.get('/api/stock-valuation', { ...getHeaders(token), params });
  return res.data.data;
};

// ---------- Cost Revaluation (revaluasi HPP) ----------

const REV = '/api/cost-revaluation';
export const getCostRevaluations = async (token, params) => (await axios.get(REV, { ...getHeaders(token), params })).data.data;
export const getCostRevaluation = async (id, token) => (await axios.get(`${REV}/${id}`, getHeaders(token))).data.data;
/** params { search } | { produk } | { kategori } | { missingOnly: true } -> [{ _id, sku, produk, variant, uom, qty, avgCost }] */
export const searchRevaluationSkus = async (token, params) => (await axios.get(`${REV}/skus`, { ...getHeaders(token), params })).data.data;
export const createCostRevaluation = (data, token) => axios.post(REV, data, getHeaders(token));
export const updateCostRevaluation = (id, data, token) => axios.put(`${REV}/${id}`, data, getHeaders(token));
export const deleteCostRevaluation = (id, token) => axios.delete(`${REV}/${id}`, getHeaders(token));
export const postCostRevaluation = (id, token) => axios.post(`${REV}/${id}/post`, {}, getHeaders(token));
export const cancelCostRevaluation = (id, reason, token) => axios.post(`${REV}/${id}/cancel`, { reason }, getHeaders(token));

// ---------- Reorder (izin reorder) ----------

const RO = '/api/reorder';
/** params { status: OUT|CRITICAL|ORDERED|ALL, gudang, kategori, vendor, search } */
export const getReorderAlerts = async (token, params) => (await axios.get(RO, { ...getHeaders(token), params })).data.data;
/** -> { OUT, CRITICAL, ORDERED, needAction, monitored } */
export const getReorderSummary = async (token) => (await axios.get(`${RO}/summary`, getHeaders(token))).data.data;
export const getReorderRules = async (token, produk) => (await axios.get(`${RO}/rules`, { ...getHeaders(token), params: { produk } })).data.data;
/** rules: [{ sku, gudang, minQty, maxQty }] (min & max kosong = hapus) */
export const saveReorderRules = (rules, token) => axios.put(`${RO}/rules`, { rules }, getHeaders(token));
/** items: [{ sku, gudang, vendor, uomBeli, konversi, qty, hargaBeli }] -> draft PO per vendor + gudang */
export const createPoFromReorder = (items, token) => axios.post(`${RO}/create-po`, { items }, getHeaders(token));
