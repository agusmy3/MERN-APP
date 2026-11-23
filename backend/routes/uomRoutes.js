const express = require('express');
const router = express.Router();
const {
  getAllUom,
  getUom,
  getSingleUom,
  createUom,
  updateUom,
  deleteUom
} = require('../controllers/uomController');
const Uom = require('../models/Uom');
const protect = require('../middlewares/authMiddleware');
const authorize = require('../middlewares/authorize');
const { dropdownHandler } = require('../helpers/dropdownHelper');

// Izin: view = lihat/cari/detail, create/update/delete sesuai operasi (lihat config/permissions.js)
// /dropdown cukup login: untuk pilihan di form resource lain, hanya field ringkas
router.get('/dropdown', protect, dropdownHandler(Uom, '_id code name', { code: 1 }));
router.get('/all', protect, authorize('uom', 'view'), getAllUom);
router.get('/', protect, authorize('uom', 'view'), getUom);
router.get('/:id', protect, authorize('uom', 'view'), getSingleUom);
router.post('/', protect, authorize('uom', 'create'), createUom);
router.put('/:id', protect, authorize('uom', 'update'), updateUom);
router.delete('/:id', protect, authorize('uom', 'delete'), deleteUom);

module.exports = router;
