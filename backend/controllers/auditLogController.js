const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');
const { gudangScope } = require('../helpers/gudangAccess');
const {
  successResponse,
  errorResponse
} = require("../helpers/responseHelper");
const { hasPermission } = require('../config/permissions');

/**
 * Entity log -> resource izin yang dibutuhkan untuk MELIHAT log-nya.
 * Log harga vendor berisi harga beli, jadi tetap butuh vendorPrice:view walau tampil di histori produk.
 */
const ENTITY_RESOURCE = {
  produk: 'produk',
  produkSku: 'produk',
  vendorPrice: 'vendorPrice',
  role: 'role',
  user: 'user',
  auth: 'user', // log login
  kategori: 'kategori',
  vendor: 'vendor',
  uom: 'uom',
  variant: 'variant',
  menu: 'menu',
  gudang: 'gudang',
  stockAdjustment: 'stockAdjustment',
  stockTransfer: 'stockTransfer',
  purchaseOrder: 'purchaseOrder',
  goodsReceipt: 'goodsReceipt',
  costRevaluation: 'costRevaluation',
  customer: 'customer',
  salesInvoice: 'salesInvoice',
  salesOrder: 'salesOrder',
  quotation: 'quotation',
  purchaseInvoice: 'purchaseInvoice',
  vendorPayment: 'vendorPayment',
  purchaseReturn: 'purchaseReturn',
  customerReceipt: 'salesPayment',
  customerDeposit: 'salesPayment',
  vendorDeposit: 'vendorPayment',
  vendorPaymentBatch: 'vendorPayment',
  deliveryOrder: 'deliveryOrder',
  salesReturn: 'salesReturn',
  salesPayment: 'salesPayment',
  priceList: 'priceList',
  outlet: 'outlet',
  posShift: 'posShift',
  reorderRule: 'reorder',
  setting: 'setting',
};

// entity yang punya histori per record (tombol/tab History)
const HISTORY_ENTITIES = ['produk', 'role', 'user', 'kategori', 'vendor', 'uom', 'variant', 'menu', 'gudang', 'stockAdjustment', 'stockTransfer', 'purchaseOrder', 'goodsReceipt', 'costRevaluation', 'customer', 'salesInvoice', 'salesReturn', 'priceList', 'outlet', 'posShift', 'salesOrder', 'deliveryOrder', 'quotation', 'purchaseInvoice', 'purchaseReturn', 'customerReceipt', 'vendorPaymentBatch', 'customerDeposit', 'vendorDeposit'];

// scope tab History produk -> entity log
const PRODUK_SCOPES = { info: 'produk', sku: 'produkSku', prices: 'vendorPrice' };

// log tagihan & pembayaran vendor berisi harga beli: butuh juga vendorPrice:view
const COST_ENTITIES = ['purchaseInvoice', 'vendorPayment', 'vendorPaymentBatch', 'vendorDeposit'];
const canSeeEntity = (user, entity) => hasPermission(user, ENTITY_RESOURCE[entity], 'view')
  && (!COST_ENTITIES.includes(entity) || hasPermission(user, 'vendorPrice', 'view'));

/**
 * Akses gudang: log dokumen per gudang hanya terlihat jika salah satu gudangnya boleh diakses user;
 * log tanpa gudang (master data, setting, user, ...) tidak disaring. -> filter tambahan atau null.
 */
const gudangLogFilter = (req) => {
  const scope = gudangScope(req);
  if (!scope) return null;
  return { $or: [{ gudangs: { $exists: false } }, { gudangs: { $size: 0 } }, { gudangs: { $in: scope.map((id) => new mongoose.Types.ObjectId(id)) } }] };
};
const withGudang = (req, filter) => {
  const g = gudangLogFilter(req);
  return g ? { $and: [filter, g] } : filter;
};

const visibleEntities = (user) => Object.keys(ENTITY_RESOURCE).filter((entity) => canSeeEntity(user, entity));

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const paging = (req, defaultSize) => {
  const page = Math.max(parseInt(req.query.page || 1) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || defaultSize) || defaultSize, 1), 100);
  return { page, pageSize };
};

const findPage = async (filter, { page, pageSize }, sortOrder = -1) => {
  const [totalData, logs] = await Promise.all([
    AuditLog.countDocuments(filter),
    AuditLog.find(filter)
      .sort({ date: sortOrder, _id: sortOrder })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
  ]);
  return { logs, totalData, currentPage: page, totalPages: Math.ceil(totalData / pageSize) };
};

/**
 * GET /api/audit-log/history?entity=produk&id=<id>[&scope=info|sku|prices]&page=&pageSize=
 * Histori 1 record. Izin = view pada resource record tsb (bukan izin auditLog).
 * Produk: termasuk perubahan SKU & harga vendornya (harga vendor hanya jika boleh vendorPrice:view).
 * User: termasuk riwayat login-nya.
 */
exports.getHistory = async (req, res) => {
  try {
    const { entity, id, scope } = req.query;
    if (!HISTORY_ENTITIES.includes(entity)) return errorResponse(res, 'Invalid entity', 400);
    if (!mongoose.isValidObjectId(id)) return errorResponse(res, 'Invalid id', 400);
    if (!canSeeEntity(req.user, entity)) {
      return errorResponse(res, "You don't have permission to view this history", 403);
    }

    const allowed = visibleEntities(req.user);
    const oid = new mongoose.Types.ObjectId(id);
    let filter;

    if (entity === 'produk') {
      filter = {
        entity: { $in: allowed },
        $or: [{ entity: 'produk', entityId: oid }, { 'parent.id': oid }],
      };
      if (scope && PRODUK_SCOPES[scope]) {
        filter.entity = allowed.includes(PRODUK_SCOPES[scope]) ? PRODUK_SCOPES[scope] : '__none__';
      }
    } else if (['purchaseOrder', 'salesInvoice', 'salesOrder', 'purchaseInvoice'].includes(entity)) {
      // PO + penerimaan barangnya / invoice + retur & pembayarannya / SO + pengirimannya (hanya entity yang boleh dilihat)
      filter = {
        entity: { $in: allowed },
        $or: [{ entity, entityId: oid }, { 'parent.id': oid }],
      };
    } else if (entity === 'user') {
      filter = { entity: { $in: ['user', 'auth'] }, entityId: oid };
      if (scope === 'login') filter.entity = 'auth';
      if (scope === 'changes') filter.entity = 'user';
    } else {
      filter = { entity, entityId: oid };
    }

    return successResponse(res, await findPage(withGudang(req, filter), paging(req, 20)));
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * GET /api/audit-log — halaman Audit Log global (izin auditLog:view)
 * Query: search (record / user), entity, action, user, from, to (YYYY-MM-DD), page, pageSize, sortOrder
 * Isi tetap disaring: hanya entity yang resource-nya boleh di-view user.
 */
exports.getAuditLogs = async (req, res) => {
  try {
    const allowed = visibleEntities(req.user);
    const filter = { entity: { $in: allowed } };

    if (req.query.entity) {
      filter.entity = allowed.includes(req.query.entity) ? req.query.entity : '__none__';
    }
    if (req.query.action) filter.action = String(req.query.action);
    if (req.query.user) {
      if (!mongoose.isValidObjectId(req.query.user)) return errorResponse(res, 'Invalid user', 400);
      filter.user = req.query.user;
    }
    if (req.query.from || req.query.to) {
      filter.date = {};
      if (req.query.from) filter.date.$gte = new Date(`${req.query.from}T00:00:00`);
      if (req.query.to) filter.date.$lte = new Date(`${req.query.to}T23:59:59.999`);
      if (Object.values(filter.date).some((d) => Number.isNaN(d.getTime()))) {
        return errorResponse(res, 'Invalid date', 400);
      }
    }
    if (req.query.search) {
      const rx = { $regex: escapeRegex(req.query.search), $options: 'i' };
      filter.$or = [{ entityLabel: rx }, { userName: rx }, { 'changes.label': rx }];
    }

    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    return successResponse(res, await findPage(withGudang(req, filter), paging(req, 10), sortOrder));
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

// dipakai dashboard (aktivitas terbaru disaring sesuai izin)
exports.ENTITY_RESOURCE = ENTITY_RESOURCE;
exports.gudangLogFilter = gudangLogFilter;
exports.visibleEntities = visibleEntities;
