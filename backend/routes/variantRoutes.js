const express = require('express');
const router = express.Router();
const {
  getAllVariant,
  getVariant,
  getSingleVariant,
  createVariant,
  updateVariant,
  deleteVariant
} = require('../controllers/variantController');
const Variant = require('../models/Variant');
const protect = require('../middlewares/authMiddleware');
const authorize = require('../middlewares/authorize');
const { dropdownHandler } = require('../helpers/dropdownHelper');

// Izin: view = lihat/cari/detail, create/update/delete sesuai operasi (lihat config/permissions.js)
// /dropdown cukup login: untuk pilihan di form resource lain, hanya field ringkas
router.get('/dropdown', protect, dropdownHandler(Variant, '_id code name', { code: 1 }));
router.get('/all', protect, authorize('variant', 'view'), getAllVariant);
router.get('/', protect, authorize('variant', 'view'), getVariant);
router.get('/:id', protect, authorize('variant', 'view'), getSingleVariant);
router.post('/', protect, authorize('variant', 'create'), createVariant);
router.put('/:id', protect, authorize('variant', 'update'), updateVariant);
router.delete('/:id', protect, authorize('variant', 'delete'), deleteVariant);

module.exports = router;
