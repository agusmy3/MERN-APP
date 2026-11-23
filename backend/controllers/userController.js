const mongoose = require('mongoose');
const User = require('../models/User');
const Role = require('../models/Role');
const {
  successResponse,
  errorResponse
} = require("../helpers/responseHelper");
const audit = require('../helpers/auditLogger');
const { runInTransaction, HttpError, lock, ref } = require('../helpers/transaction');

const SORTABLE_FIELDS = ['name', 'email', 'createdDate', 'updatedDate'];
const MIN_PASSWORD_LENGTH = 6;

const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status);
  if (error.code === 11000) {
    return errorResponse(res, 'Email already registered', 400);
  }
  return errorResponse(res, error.message, 500);
};

const populateUser = (query) => query
  .select('-password')
  .populate('role', 'name isSystem')
  .populate('createdBy', 'name')
  .populate('updatedBy', 'name');

const findRole = async (roleId) => {
  if (!roleId || !mongoose.isValidObjectId(roleId)) return null;
  return Role.findById(roleId);
};

/**
 * Cegah aplikasi kehilangan seluruh Super Admin aktif.
 * true jika masih ada Super Admin aktif LAIN selain `excludeUserId`.
 */
const hasOtherActiveSuperAdmin = async (excludeUserId) => {
  const systemRoleIds = await Role.find({ isSystem: true }).distinct('_id');
  const count = await User.countDocuments({
    _id: { $ne: excludeUserId },
    role: { $in: systemRoleIds },
    isActive: { $ne: false },
  });
  return count > 0;
};

// GET /api/user — search, sort, paginasi
exports.getUser = async (req, res) => {
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
        { email: { $regex: search, $options: "i" } }
      ];
    }

    const totalData = await User.countDocuments(filter);

    const dataUser = await populateUser(User.find(filter))
      .collation({ locale: 'en', strength: 2 })
      .sort({ [sortField]: sortOrder })
      .skip((page - 1) * pageSize)
      .limit(pageSize);

    return successResponse(res, {
      dataUser,
      totalData,
      currentPage: page,
      totalPages: Math.ceil(totalData / pageSize)
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// GET /api/user/:id
exports.getSingleUser = async (req, res) => {
  try {
    const user = await populateUser(User.findById(req.params.id));
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }
    return successResponse(res, user);
  } catch (error) {
    return handleError(res, error);
  }
};

// POST /api/user — dibuat oleh admin (registrasi publik dimatikan)
exports.createUser = async (req, res) => {
  try {
    const { name, email, password, role: roleId, isActive } = req.body;

    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      return errorResponse(res, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`, 400);
    }

    const user = await runInTransaction(async () => {
      await lock(ref('role', roleId)); // role tidak boleh terhapus bersamaan
      const role = await findRole(roleId);
      if (!role) throw new HttpError('Please select a valid role', 400);

      const user = await User.create({
        name,
        email,
        password, // di-hash oleh pre('save')
        role: role._id,
        isActive: isActive !== false,
        createdBy: req.user._id
      });
      await audit.logCreate(req, 'user', [user]);
      return user;
    });

    const saved = user.toObject();
    delete saved.password;
    return successResponse(res, saved, "User successfully added", 201);
  } catch (error) {
    return handleError(res, error);
  }
};

// PUT /api/user/:id — password opsional (kosong = tidak diubah)
exports.updateUser = async (req, res) => {
  try {
    const { name, email, password, role: roleId, isActive } = req.body;
    if (password && password.length < MIN_PASSWORD_LENGTH) {
      return errorResponse(res, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`, 400);
    }

    const user = await runInTransaction(async () => {
      const user = await User.findById(req.params.id).populate('role');
      if (!user) throw new HttpError('User not found', 404);

      const isSelf = String(user._id) === String(req.user._id);

      let newRole = user.role;
      if (roleId !== undefined && String(roleId) !== String(user.role?._id)) {
        if (isSelf) throw new HttpError('You cannot change your own role', 400);
        await lock(ref('role', roleId));
        newRole = await findRole(roleId);
        if (!newRole) throw new HttpError('Please select a valid role', 400);
      }

      const newIsActive = isActive === undefined ? user.isActive !== false : isActive !== false;
      if (isSelf && !newIsActive) throw new HttpError('You cannot deactivate your own account', 400);

      // Super Admin aktif -> kehilangan status (ganti role / dinonaktifkan): pastikan masih ada yang lain.
      // Kunci 'superadmin': 2 admin yang saling menonaktifkan bersamaan tidak bisa sama-sama lolos.
      const wasActiveSuperAdmin = !!user.role?.isSystem && user.isActive !== false;
      const staysActiveSuperAdmin = !!newRole?.isSystem && newIsActive;
      if (wasActiveSuperAdmin && !staysActiveSuperAdmin) {
        await lock('superadmin');
        if (!(await hasOtherActiveSuperAdmin(user._id))) {
          throw new HttpError('At least one active Super Admin is required', 400);
        }
      }

      const before = await audit.snap('user', [user]);
      if (password) user.password = password; // di-hash oleh pre('save')
      user.name = name || user.name;
      user.email = email || user.email;
      user.role = newRole?._id ?? null;
      user.isActive = newIsActive;
      user.updatedDate = new Date();
      user.updatedBy = req.user._id;
      await user.save();
      await audit.logUpdate(req, 'user', before, [user]);
      return user;
    });

    const saved = user.toObject();
    delete saved.password;
    return successResponse(res, saved, "User successfully updated", 200);
  } catch (error) {
    return handleError(res, error);
  }
};

// DELETE /api/user/:id
exports.deleteUser = async (req, res) => {
  try {
    const user = await runInTransaction(async () => {
      const user = await User.findById(req.params.id).populate('role');
      if (!user) throw new HttpError('User not found', 404);
      if (String(user._id) === String(req.user._id)) throw new HttpError('You cannot delete your own account', 400);
      if (user.role?.isSystem && user.isActive !== false) {
        await lock('superadmin');
        if (!(await hasOtherActiveSuperAdmin(user._id))) {
          throw new HttpError('At least one active Super Admin is required', 400);
        }
      }

      const before = await audit.snap('user', [user]);
      await user.deleteOne();
      await audit.logDelete(req, 'user', before);
      return user;
    });

    return successResponse(res, { _id: user._id, name: user.name }, "User successfully deleted", 200);
  } catch (error) {
    return handleError(res, error);
  }
};
