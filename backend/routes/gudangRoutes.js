const express = require('express');
const router = express.Router();
const {
  getAllGudang,
  getGudang,
  getSingleGudang,
  createGudang,
  updateGudang,
  deleteGudang
} = require('../controllers/gudangController');
const Gudang = require('../models/Gudang');
const protect = require('../middlewares/authMiddleware');
const authorize = require('../middlewares/authorize');
const { canAccessGudang } = require('../helpers/gudangAccess');
const { successResponse, errorResponse } = require('../helpers/responseHelper');

/**
 * /dropdown cukup login: pilihan gudang di dokumen stok & filter. isActive untuk menyaring di form,
 * accessible = user boleh memakai gudang tsb (dokumen & laporan hanya untuk gudang yang accessible).
 */
router.get('/dropdown', protect, async (req, res) => {
  try {
    const list = await Gudang.find().select('_id code name isActive').sort({ code: 1 }).lean();
    list.forEach((g) => { g.accessible = canAccessGudang(req, g._id); });
    return successResponse(res, list);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});
router.get('/all', protect, authorize('gudang', 'view'), getAllGudang);
router.get('/', protect, authorize('gudang', 'view'), getGudang);
router.get('/:id', protect, authorize('gudang', 'view'), getSingleGudang);
router.post('/', protect, authorize('gudang', 'create'), createGudang);
router.put('/:id', protect, authorize('gudang', 'update'), updateGudang);
router.delete('/:id', protect, authorize('gudang', 'delete'), deleteGudang);

module.exports = router;
