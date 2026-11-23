import axios from 'axios';

const API = '/api/audit-log';

const getHeaders = (token) => ({
  headers: {
    Authorization: `Bearer ${token}`
  }
});

/**
 * Histori 1 record: params { entity: 'produk'|'role'|'user', id, scope?, page, pageSize }
 * -> { logs, totalData, currentPage, totalPages }
 */
export const getAuditHistory = async (token, params) => {
  const res = await axios.get(`${API}/history`, { ...getHeaders(token), params });
  return res.data.data;
};

/** Audit Log global (izin auditLog:view): params { search, entity, action, from, to, page, pageSize, sortOrder } */
export const getAuditLogs = async (token, params) => {
  const res = await axios.get(API, { ...getHeaders(token), params });
  return res.data.data;
};
