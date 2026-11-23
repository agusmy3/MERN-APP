const Role = require('../models/Role');
const User = require('../models/User');
const {
  successResponse,
  errorResponse
} = require("../helpers/responseHelper");
const { ACTIONS, getResourceRegistry, normalizePermissions } = require('../config/permissions');
const audit = require('../helpers/auditLogger');
const { runInTransaction, HttpError, lock, ref } = require('../helpers/transaction');

const SORTABLE_FIELDS = ['name', 'createdDate', 'updatedDate'];

const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status);
  if (error.code === 11000) {
    return errorResponse(res, 'Role name already exists', 400);
  }
  return errorResponse(res, error.message, 500);
};

// Tambahkan jumlah user per role (untuk kolom tabel & pengecekan hapus)
const withUserCount = async (roles) => {
  const counts = await User.aggregate([
    { $match: { role: { $in: roles.map((r) => r._id) } } },
    { $group: { _id: '$role', count: { $sum: 1 } } },
  ]);
  const map = new Map(counts.map((c) => [String(c._id), c.count]));
  return roles.map((r) => ({ ...r, userCount: map.get(String(r._id)) || 0 }));
};

// GET /api/role/resources — daftar resource & action untuk matriks izin (cukup login)
exports.getResources = async (req, res) => {
  return successResponse(res, { resources: getResourceRegistry(), actions: ACTIONS });
};

// GET /api/role — search, sort, paginasi
exports.getRole = async (req, res) => {
  try {
    const search = req.query.search || '';
    const page = parseInt(req.query.page || 1);
    const pageSize = parseInt(req.query.pageSize || 5);
    const sortField = SORTABLE_FIELDS.includes(req.query.sortField)
      ? req.query.sortField
      : 'createdDate';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    let filter = {};

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { deskripsi: { $regex: search, $options: "i" } }
      ];
    }

    const totalData = await Role.countDocuments(filter);

    const roles = await Role.find(filter)
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .collation({ locale: 'en', strength: 2 })
      .sort({ [sortField]: sortOrder })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean();

    return successResponse(res, {
      dataRole: await withUserCount(roles),
      totalData,
      currentPage: page,
      totalPages: Math.ceil(totalData / pageSize)
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// GET /api/role/:id
exports.getSingleRole = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id)
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .lean();
    if (!role) {
      return errorResponse(res, 'Role not found', 404);
    }
    const [withCount] = await withUserCount([role]);
    return successResponse(res, withCount);
  } catch (error) {
    return handleError(res, error);
  }
};

// POST /api/role
exports.createRole = async (req, res) => {
  try {
    const role = await runInTransaction(async () => {
      const role = await Role.create({
        name: req.body.name,
        deskripsi: req.body.deskripsi,
        isSystem: false, // role sistem hanya dibuat lewat script seed
        permissions: normalizePermissions(req.body.permissions),
        createdBy: req.user._id
      });
      await audit.logCreate(req, 'role', [role]);
      return role;
    });

    return successResponse(res, role, "Role successfully added", 201);
  } catch (error) {
    return handleError(res, error);
  }
};

// PUT /api/role/:id
exports.updateRole = async (req, res) => {
  try {
    const role = await runInTransaction(async () => {
      const role = await Role.findById(req.params.id);
      if (!role) throw new HttpError('Role not found', 404);
      if (role.isSystem) throw new HttpError('System role cannot be modified', 400);

      const before = await audit.snap('role', [role]);
      role.name = req.body.name || role.name;
      role.deskripsi = req.body.deskripsi ?? role.deskripsi;
      if (req.body.permissions !== undefined) {
        role.permissions = normalizePermissions(req.body.permissions);
      }
      role.updatedDate = new Date();
      role.updatedBy = req.user._id;
      await role.save();
      await audit.logUpdate(req, 'role', before, [role]);
      return role;
    });

    return successResponse(res, role, "Role successfully updated", 200);
  } catch (error) {
    return handleError(res, error);
  }
};

// DELETE /api/role/:id
exports.deleteRole = async (req, res) => {
  try {
    const role = await runInTransaction(async () => {
      const role = await Role.findById(req.params.id);
      if (!role) throw new HttpError('Role not found', 404);
      if (role.isSystem) throw new HttpError('System role cannot be deleted', 400);

      // kunci: bentrok dengan create/update user yang diberi role ini
      await lock(ref('role', role._id));
      const userCount = await User.countDocuments({ role: role._id });
      if (userCount > 0) {
        throw new HttpError(`Role is still used by ${userCount} user(s). Change their role first.`, 400);
      }

      const before = await audit.snap('role', [role]);
      await role.deleteOne();
      await audit.logDelete(req, 'role', before);
      return role;
    });

    return successResponse(res, role, "Role successfully deleted", 200);
  } catch (error) {
    return handleError(res, error);
  }
};
