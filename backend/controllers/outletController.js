const mongoose = require('mongoose');
const Outlet = require('../models/Outlet');
const Gudang = require('../models/Gudang');
const { successResponse, errorResponse } = require('../helpers/responseHelper');
const audit = require('../helpers/auditLogger');
const { runInTransaction, HttpError, lock, ref } = require('../helpers/transaction');
const { parseLocation } = require('../helpers/locationHelper');

const SORTABLE_FIELDS = ['code', 'name', 'provinsi', 'kota', 'createdDate', 'updatedDate'];

const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status);
  if (error.code === 11000) return errorResponse(res, 'Outlet code already exists', 400);
  if (error.name === 'ValidationError' || error.name === 'CastError') return errorResponse(res, error.message, 400);
  return errorResponse(res, error.message, 500);
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Field POS dari body (hanya yang dikirim) */
const parsePos = (body) => {
  const out = {};
  if (body.phone !== undefined) out.phone = String(body.phone || '').trim().slice(0, 40);
  if (body.priceIncludesTax !== undefined) out.priceIncludesTax = body.priceIncludesTax !== false;
  if (body.receiptHeader !== undefined) out.receiptHeader = String(body.receiptHeader || '').slice(0, 500);
  if (body.receiptFooter !== undefined) out.receiptFooter = String(body.receiptFooter || '').slice(0, 500);
  if (body.receiptWidth !== undefined) {
    const w = Number(body.receiptWidth);
    if (![58, 80].includes(w)) throw new HttpError('Receipt width must be 58 or 80 mm', 400);
    out.receiptWidth = w;
  }
  return out;
};

/** Gudang sumber stok: wajib, harus ada & aktif (di dalam transaksi, dikunci) */
const resolveGudang = async (id) => {
  if (!mongoose.isValidObjectId(id)) throw new HttpError('Please select the warehouse that supplies this outlet', 400);
  await lock(ref('gudang', id));
  const g = await Gudang.findById(id).select('code isActive').lean();
  if (!g) throw new HttpError('Warehouse not found', 400);
  if (g.isActive === false) throw new HttpError(`Warehouse ${g.code} is inactive`, 400);
  return String(id);
};

// GET /api/outlet — paginasi + search
exports.getOutlets = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || 1) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || 5) || 5, 1), 100);
    const sortField = SORTABLE_FIELDS.includes(req.query.sortField) ? req.query.sortField : 'createdDate';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const filter = {};
    if (req.query.search) {
      const rx = { $regex: escapeRegex(req.query.search), $options: 'i' };
      filter.$or = ['code', 'name', 'alamat', 'provinsi', 'kota', 'kecamatan', 'kodePos', 'phone'].map((f) => ({ [f]: rx }));
    }
    const [totalData, dataOutlet] = await Promise.all([
      Outlet.countDocuments(filter),
      Outlet.find(filter)
        .populate('gudang', 'code name isActive')
        .populate('createdBy', 'name')
        .populate('updatedBy', 'name')
        .collation({ locale: 'en', strength: 2 })
        .sort({ [sortField]: sortOrder })
        .skip((page - 1) * pageSize)
        .limit(pageSize),
    ]);
    return successResponse(res, { dataOutlet, totalData, currentPage: page, totalPages: Math.ceil(totalData / pageSize) });
  } catch (error) {
    return handleError(res, error);
  }
};

exports.getOutlet = async (req, res) => {
  try {
    const outlet = await Outlet.findById(req.params.id).populate('gudang', 'code name isActive');
    if (!outlet) return errorResponse(res, 'Outlet not found', 404);
    return successResponse(res, outlet);
  } catch (error) {
    return handleError(res, error);
  }
};

exports.createOutlet = async (req, res) => {
  try {
    const location = parseLocation(req.body);
    const pos = parsePos(req.body);
    const outlet = await runInTransaction(async () => {
      const gudang = await resolveGudang(req.body.gudang);
      const outlet = await Outlet.create({
        code: req.body.code,
        name: req.body.name,
        gudang,
        ...location,
        ...pos,
        isActive: req.body.isActive !== false,
        createdBy: req.user._id,
      });
      await audit.logCreate(req, 'outlet', [outlet]);
      return outlet;
    });
    return successResponse(res, outlet, 'Outlet successfully added', 201);
  } catch (error) {
    return handleError(res, error);
  }
};

// PUT /api/outlet/:id — gudang boleh diganti hanya selama tidak ada shift OPEN
exports.updateOutlet = async (req, res) => {
  try {
    const location = parseLocation(req.body);
    const pos = parsePos(req.body);
    const outlet = await runInTransaction(async () => {
      const outlet = await Outlet.findById(req.params.id);
      if (!outlet) throw new HttpError('Outlet not found', 404);
      await lock(ref('outlet', outlet._id));
      const before = await audit.snap('outlet', [outlet]);
      if (req.body.gudang !== undefined && String(req.body.gudang) !== String(outlet.gudang)) {
        const open = await require('../models/PosShift').exists({ outlet: outlet._id, status: 'OPEN' });
        if (open) throw new HttpError('Close the open POS shifts of this outlet before changing its warehouse', 400);
        outlet.gudang = await resolveGudang(req.body.gudang);
      }
      outlet.code = req.body.code || outlet.code;
      outlet.name = req.body.name || outlet.name;
      Object.assign(outlet, location, pos);
      if (req.body.isActive !== undefined) outlet.isActive = req.body.isActive !== false;
      outlet.updatedDate = new Date();
      outlet.updatedBy = req.user._id;
      await outlet.save();
      await audit.logUpdate(req, 'outlet', before, [outlet]);
      return outlet;
    });
    return successResponse(res, outlet, 'Outlet successfully updated');
  } catch (error) {
    return handleError(res, error);
  }
};

// DELETE /api/outlet/:id — ditolak jika sudah punya shift / transaksi; lepas dari penugasan kasir
exports.deleteOutlet = async (req, res) => {
  try {
    const outlet = await runInTransaction(async () => {
      const outlet = await Outlet.findById(req.params.id);
      if (!outlet) throw new HttpError('Outlet not found', 404);
      await lock(ref('outlet', outlet._id));
      const [shifts, sales] = await Promise.all([
        require('../models/PosShift').exists({ outlet: outlet._id }),
        require('../models/SalesInvoice').exists({ outlet: outlet._id }),
      ]);
      if (shifts || sales) throw new HttpError('Outlet already has POS shifts or sales. Deactivate it instead.', 400);

      const batchId = audit.newBatchId();
      const User = require('../models/User');
      const users = await User.find({ outlets: outlet._id });
      if (users.length) {
        const usersBefore = await audit.snap('user', users);
        for (const u of users) {
          u.outlets.pull(outlet._id);
          await u.save();
        }
        await audit.logUpdate(req, 'user', usersBefore, users, { batchId });
      }
      const before = await audit.snap('outlet', [outlet]);
      await outlet.deleteOne();
      await audit.logDelete(req, 'outlet', before, { batchId });
      return outlet;
    });
    return successResponse(res, outlet, 'Outlet successfully deleted');
  } catch (error) {
    return handleError(res, error);
  }
};
