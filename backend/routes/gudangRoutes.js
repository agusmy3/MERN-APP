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
const { dropdownHandler } = require('../helpers/dropdownHelper');

// /dropdown cukup login: pilihan gudang di dokumen stok & filter (isActive untuk menyaring di form)
router.get('/dropdown', protect, dropdownHandler(Gudang, '_id code name isActive', { code: 1 }));
router.get('/all', protect, authorize('gudang', 'view'), getAllGudang);
router.get('/', protect, authorize('gudang', 'view'), getGudang);
router.get('/:id', protect, authorize('gudang', 'view'), getSingleGudang);
router.post('/', protect, authorize('gudang', 'create'), createGudang);
router.put('/:id', protect, authorize('gudang', 'update'), updateGudang);
router.delete('/:id', protect, authorize('gudang', 'delete'), deleteGudang);

module.exports = router;
