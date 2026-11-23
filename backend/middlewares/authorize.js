const { hasPermission, getResourceLabel } = require('../config/permissions');
const { errorResponse } = require('../helpers/responseHelper');

/**
 * Cek izin RBAC. Pasang SETELAH protect:
 *   router.post('/', protect, authorize('produk', 'create'), createProduk);
 * Tanpa izin -> 403 (bukan 401, supaya frontend tidak logout).
 */
const authorize = (resource, action) => (req, res, next) => {
  if (hasPermission(req.user, resource, action)) return next();
  return errorResponse(
    res,
    `You don't have permission to ${action} ${getResourceLabel(resource)}`,
    403
  );
};

module.exports = authorize;
