const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { errorResponse } = require('../helpers/responseHelper');

/**
 * Wajib login. Mengisi req.user (tanpa password, role sudah di-populate) supaya
 * authorize() bisa langsung mengecek izin. Perubahan role/izin berlaku seketika
 * karena dibaca ulang dari database di setiap request.
 */
const protect = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return errorResponse(res, 'Tidak ada token', 401);
  }

  let decoded;
  try {
    decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
  } catch {
    return errorResponse(res, 'Token tidak valid', 401);
  }

  const user = await User.findById(decoded.id).select('-password').populate('role');
  if (!user) {
    return errorResponse(res, 'User tidak ditemukan', 401);
  }
  if (user.isActive === false) {
    return errorResponse(res, 'Your account is inactive. Please contact the administrator.', 401);
  }

  req.user = user;
  // dipanggil di luar try/catch, supaya error di handler berikutnya tidak dilaporkan sebagai "Token tidak valid"
  next();
};

module.exports = protect;
