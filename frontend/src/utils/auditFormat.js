import { formatNumber, formatRupiah } from './formatHelper';
import { formatDay } from './dateHelper';

/** Label & ikon per entity log (key sama dengan backend helpers/auditLogger.js) */
export const ENTITY_META = {
  produk: { label: 'Product', icon: 'fa-box' },
  produkSku: { label: 'SKU', icon: 'fa-layer-group' },
  vendorPrice: { label: 'Vendor Price', icon: 'fa-truck' },
  role: { label: 'Role', icon: 'fa-user-shield' },
  user: { label: 'User', icon: 'fa-user' },
  auth: { label: 'Login', icon: 'fa-right-to-bracket' },
  kategori: { label: 'Category', icon: 'fa-tags' },
  vendor: { label: 'Vendor', icon: 'fa-building' },
  uom: { label: 'UoM', icon: 'fa-ruler' },
  variant: { label: 'Variant', icon: 'fa-swatchbook' },
  menu: { label: 'Menu', icon: 'fa-bars' },
  gudang: { label: 'Warehouse', icon: 'fa-warehouse' },
  stockAdjustment: { label: 'Stock Adjustment', icon: 'fa-boxes-stacked' },
  purchaseOrder: { label: 'Purchase Order', icon: 'fa-file-invoice' },
  goodsReceipt: { label: 'Goods Receipt', icon: 'fa-truck-ramp-box' },
  costRevaluation: { label: 'Cost Revaluation', icon: 'fa-scale-balanced' },
  setting: { label: 'System Settings', icon: 'fa-sliders' },
};

export const ACTION_META = {
  create: { label: 'Created', icon: 'fa-plus', tone: 'bg-success-soft text-success-fg' },
  update: { label: 'Updated', icon: 'fa-pen', tone: 'bg-primary-soft text-primary-soft-fg' },
  delete: { label: 'Deleted', icon: 'fa-trash', tone: 'bg-danger-soft text-danger' },
  login: { label: 'Login', icon: 'fa-right-to-bracket', tone: 'bg-subtle text-muted' },
  login_failed: { label: 'Login failed', icon: 'fa-triangle-exclamation', tone: 'bg-warning-soft text-warning-fg' },
};

export const LOGIN_REASON = {
  wrong_password: 'Password salah',
  unknown_email: 'Email tidak terdaftar',
  inactive: 'Akun nonaktif',
};

const isEmpty = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/** Nilai 1 sisi perubahan (from/to) menjadi teks sesuai format-nya */
export const formatAuditValue = (change, value) => {
  if (change.format === 'secret') return '••••••';
  if (isEmpty(value)) return null;
  if (Array.isArray(value)) return value.map((v) => v?.text ?? String(v)).join(', ');
  if (typeof value === 'object') return value.text ?? JSON.stringify(value);
  switch (change.format) {
    case 'money': return formatRupiah(value);
    case 'number': return formatNumber(value);
    case 'bool': return value ? 'Yes' : 'No';
    case 'date': return formatDay(value);
    default: return String(value);
  }
};

/** Perubahan daftar (mis. nilai Variant): { added: [...], removed: [...] } */
export const listDiff = (from, to) => {
  const a = Array.isArray(from) ? from : [];
  const b = Array.isArray(to) ? to : [];
  return { added: b.filter((v) => !a.includes(v)), removed: a.filter((v) => !b.includes(v)) };
};

/**
 * Kelompokkan log berurutan yang punya batchId sama (1 aksi = banyak log, mis. bulk edit).
 * -> [{ key, logs: [...] }]
 */
export const groupByBatch = (logs) => {
  const groups = [];
  for (const log of logs) {
    const last = groups[groups.length - 1];
    if (log.batchId && last && last.batchId === log.batchId) last.logs.push(log);
    else groups.push({ key: log.batchId || log._id, batchId: log.batchId, logs: [log] });
  }
  return groups;
};

/** Ringkasan 1 grup: "Updated 3 SKU", "Deleted Product (+6 SKU, +12 Vendor Price)" */
export const summarizeGroup = (logs) => {
  if (logs.length === 1) {
    const l = logs[0];
    return `${ACTION_META[l.action]?.label || l.action} ${ENTITY_META[l.entity]?.label || l.entity}`;
  }
  const counts = new Map();
  for (const l of logs) {
    const k = `${l.action}:${l.entity}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([k, n]) => {
      const [action, entity] = k.split(':');
      return `${ACTION_META[action]?.label || action} ${n} ${ENTITY_META[entity]?.label || entity}`;
    })
    .join(' · ');
};
