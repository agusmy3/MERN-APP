const Customer = require('../models/Customer');
const Counter = require('../models/Counter');
const { successResponse, errorResponse } = require('../helpers/responseHelper');
const audit = require('../helpers/auditLogger');
const { runInTransaction, HttpError, lock, ref } = require('../helpers/transaction');
const { parseRegion } = require('../helpers/locationHelper');

const SORTABLE_FIELDS = ['code', 'name', 'phone', 'createdDate', 'updatedDate'];
const TEXT_FIELDS = { name: 120, phone: 40, email: 120, address: 500, npwp: 30, deskripsi: 1000 };

const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status);
  if (error.code === 11000) return errorResponse(res, 'Customer code already exists', 400);
  if (error.name === 'ValidationError' || error.name === 'CastError') return errorResponse(res, error.message, 400);
  return errorResponse(res, error.message, 500);
};

/** priceList dari body (di dalam transaksi): undefined = tidak diubah, kosong = lepas, id = harus ada (dikunci) */
const parsePriceList = async (body) => {
  if (body.priceList === undefined) return {};
  if (!body.priceList) return { priceList: null };
  if (!require('mongoose').isValidObjectId(body.priceList)) throw new HttpError('Invalid price list', 400);
  await lock(ref('priceList', body.priceList)); // bentrok dengan hapus price list
  if (!(await require('../models/PriceList').exists({ _id: body.priceList }))) throw new HttpError('Price list not found', 400);
  return { priceList: String(body.priceList) };
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Field teks dari body (hanya yang dikirim -> update parsial) */
const parseFields = (body) => {
  const out = {};
  for (const [f, max] of Object.entries(TEXT_FIELDS)) {
    if (body[f] !== undefined) out[f] = body[f] === null ? '' : String(body[f]).trim().slice(0, max);
  }
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw new HttpError('Invalid email address', 400);
  if (body.termDays !== undefined && body.termDays !== null && body.termDays !== '') {
    const n = Number(body.termDays);
    if (!Number.isInteger(n) || n < 0 || n > 365) throw new HttpError('Payment term must be a whole number of days (0 - 365)', 400);
    out.termDays = n;
  }
  Object.assign(out, parseRegion(body)); // provinsi, kota, kecamatan, kodePos, latitude, longitude
  return out;
};

/** Kode otomatis bila kosong: CUST00001 (counter di dalam transaksi) */
const nextCustomerCode = async () => {
  for (;;) {
    const c = await Counter.findOneAndUpdate({ _id: 'CUST' }, { $inc: { seq: 1 } }, { upsert: true, new: true }).lean();
    const code = `CUST${String(c.seq).padStart(5, '0')}`;
    if (!(await Customer.exists({ code }))) return code;
  }
};

// GET /api/customer — paginasi + search
exports.getCustomers = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || 1) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || 5) || 5, 1), 100);
    const sortField = SORTABLE_FIELDS.includes(req.query.sortField) ? req.query.sortField : 'createdDate';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const filter = {};
    if (req.query.search) {
      const rx = { $regex: escapeRegex(req.query.search), $options: 'i' };
      filter.$or = ['code', 'name', 'phone', 'email', 'address', 'kota', 'npwp'].map((f) => ({ [f]: rx }));
    }
    const [totalData, dataCustomer] = await Promise.all([
      Customer.countDocuments(filter),
      Customer.find(filter)
        .populate('priceList', 'code name isActive')
        .populate('createdBy', 'name')
        .populate('updatedBy', 'name')
        .collation({ locale: 'en', strength: 2 })
        .sort({ isWalkIn: -1, [sortField]: sortOrder })
        .skip((page - 1) * pageSize)
        .limit(pageSize),
    ]);
    return successResponse(res, { dataCustomer, totalData, currentPage: page, totalPages: Math.ceil(totalData / pageSize) });
  } catch (error) {
    return handleError(res, error);
  }
};

// GET /api/customer/:id
exports.getCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id).populate('priceList', 'code name isActive').populate('createdBy', 'name').populate('updatedBy', 'name');
    if (!customer) return errorResponse(res, 'Customer not found', 404);
    return successResponse(res, customer);
  } catch (error) {
    return handleError(res, error);
  }
};

// POST /api/customer — kode kosong = otomatis
exports.createCustomer = async (req, res) => {
  try {
    const fields = parseFields(req.body);
    if (!fields.name) return errorResponse(res, 'Customer name is required', 400);
    const customer = await runInTransaction(async () => {
      const code = String(req.body.code || '').trim() || await nextCustomerCode();
      const customer = await Customer.create({
        ...fields,
        ...(await parsePriceList(req.body)),
        code,
        isActive: req.body.isActive !== false,
        createdBy: req.user._id,
      });
      await audit.logCreate(req, 'customer', [customer]);
      return customer;
    });
    return successResponse(res, customer, 'Customer successfully added', 201);
  } catch (error) {
    return handleError(res, error);
  }
};

// PUT /api/customer/:id — walk-in tidak bisa dinonaktifkan
exports.updateCustomer = async (req, res) => {
  try {
    const fields = parseFields(req.body);
    if (fields.name === '') return errorResponse(res, 'Customer name is required', 400);
    const customer = await runInTransaction(async () => {
      const customer = await Customer.findById(req.params.id);
      if (!customer) throw new HttpError('Customer not found', 404);
      if (customer.isWalkIn && req.body.isActive === false) throw new HttpError('The walk-in customer cannot be deactivated', 400);

      const before = await audit.snap('customer', [customer]);
      Object.assign(customer, fields, await parsePriceList(req.body));
      if (req.body.code) customer.code = String(req.body.code).trim();
      if (req.body.isActive !== undefined) customer.isActive = req.body.isActive !== false;
      customer.updatedDate = new Date();
      customer.updatedBy = req.user._id;
      await customer.save();
      await audit.logUpdate(req, 'customer', before, [customer]);
      return customer;
    });
    return successResponse(res, customer, 'Customer successfully updated');
  } catch (error) {
    return handleError(res, error);
  }
};

// DELETE /api/customer/:id — ditolak jika walk-in atau sudah dipakai penjualan
exports.deleteCustomer = async (req, res) => {
  try {
    const customer = await runInTransaction(async () => {
      const customer = await Customer.findById(req.params.id);
      if (!customer) throw new HttpError('Customer not found', 404);
      if (customer.isWalkIn) throw new HttpError('The walk-in customer cannot be deleted', 400);
      await lock(ref('customer', customer._id)); // bentrok dengan dokumen penjualan baru
      const used = await require('../models/SalesInvoice').countDocuments({ customer: customer._id });
      if (used) throw new HttpError(`Customer is used by ${used} sales invoice(s). Deactivate it instead.`, 400);
      const orders = await require('../models/SalesOrder').countDocuments({ customer: customer._id });
      if (orders) throw new HttpError(`Customer is used by ${orders} sales order(s). Deactivate it instead.`, 400);
      const before = await audit.snap('customer', [customer]);
      await customer.deleteOne();
      await audit.logDelete(req, 'customer', before);
      return customer;
    });
    return successResponse(res, customer, 'Customer successfully deleted');
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * Pastikan customer walk-in ada (idempotent; dipakai seed:defaults & test).
 * Di luar transaksi request; aman dijalankan berulang (unique index isWalkIn).
 */
exports.ensureWalkInCustomer = async (userId = null) => {
  const found = await Customer.findOne({ isWalkIn: true });
  if (found) return { customer: found, created: false };
  const code = (await Customer.exists({ code: 'WALKIN' })) ? `WALKIN${Date.now() % 10000}` : 'WALKIN';
  const customer = await Customer.create({ code, name: 'Umum / Walk-in', isWalkIn: true, createdBy: userId });
  return { customer, created: true };
};
