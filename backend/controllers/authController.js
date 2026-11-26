const User = require('../models/User');
const generateToken = require('../utils/generateToken');
const {
  successResponse,
  errorResponse
} = require("../helpers/responseHelper");
const { getEffectivePermissions } = require('../config/permissions');
const audit = require('../helpers/auditLogger');

// Harus sama dengan daftar tema di frontend (src/theme/themes.js)
// id tema (daftar & warnanya di frontend: src/theme/themes.js + src/index.css). Backend cukup memeriksa
// formatnya; tema yang tidak dikenal frontend otomatis kembali ke tema default.
const THEME_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Data user yang dikirim ke frontend (login & /me): profil, role ringkas, dan izin efektif.
 * `user.role` harus sudah di-populate.
 */
const buildAuthPayload = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  theme: user.theme,
  role: user.role
    ? { _id: user.role._id, name: user.role.name, isSystem: !!user.role.isSystem }
    : null,
  permissions: getEffectivePermissions(user.role), // { produk: ['view', 'create'], ... }
  // akses gudang: all = semua gudang; selain itu hanya `gudangs` (lihat helpers/gudangAccess.js)
  gudangAccess: {
    all: !!user.role?.isSystem || user.allGudang !== false,
    gudangs: (user.gudangs || []).filter((g) => g && g._id).map((g) => ({ _id: g._id, code: g.code, name: g.name })),
  },
});

// Registrasi publik dimatikan: user hanya dibuat oleh admin lewat /api/user.

// POST /api/auth/login
exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email }).populate('role').populate('gudangs', 'code name');
    if (!user || !(await user.matchPassword(password))) {
      await audit.logLogin(req, {
        success: false, user, email, reason: user ? 'wrong_password' : 'unknown_email',
      });
      return errorResponse(res, 'Invalid email or password', 401);
    }
    if (user.isActive === false) {
      await audit.logLogin(req, { success: false, user, email, reason: 'inactive' });
      return errorResponse(res, 'Your account is inactive. Please contact the administrator.', 403);
    }
    const token = generateToken(user._id);
    await audit.logLogin(req, { success: true, user, email });

    return successResponse(
      res,
      { ...buildAuthPayload(user), token },
      'Login successful'
    );
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
};

// GET /api/auth/me  (protected) — profil & izin terbaru, dipanggil saat aplikasi dibuka
exports.me = async (req, res) => {
  await req.user.populate('gudangs', 'code name');
  return successResponse(res, buildAuthPayload(req.user));
};

// PUT /api/auth/theme  (protected) — simpan palet tampilan pilihan user
exports.updateTheme = async (req, res) => {
  try {
    const { theme } = req.body;
    if (typeof theme !== 'string' || theme.length > 40 || !THEME_ID.test(theme)) {
      return errorResponse(res, 'Invalid theme', 400);
    }

    // updateOne agar tidak memicu hook hash password di pre('save')
    await User.updateOne(
      { _id: req.user._id },
      { theme, updatedDate: new Date(), updatedBy: req.user._id }
    );

    return successResponse(res, { theme }, 'Theme successfully updated', 200);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};
