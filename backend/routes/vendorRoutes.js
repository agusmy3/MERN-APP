const express = require('express');
const router = express.Router();
const {
  getAllVendor,
  getVendor,
  getSingleVendor,
  createVendor,
  updateVendor,
  deleteVendor
} = require('../controllers/vendorController');
const Vendor = require('../models/Vendor');
const protect = require('../middlewares/authMiddleware');
const authorize = require('../middlewares/authorize');
const { dropdownHandler } = require('../helpers/dropdownHelper');

// Izin: view = lihat/cari/detail, create/update/delete sesuai operasi (lihat config/permissions.js)
// /dropdown cukup login: untuk pilihan di form resource lain, hanya field ringkas
router.get('/dropdown', protect, dropdownHandler(Vendor, '_id companyName', { companyName: 1 }));
router.get('/all', protect, authorize('vendor', 'view'), getAllVendor);
router.get('/', protect, authorize('vendor', 'view'), getVendor);
router.get('/:id', protect, authorize('vendor', 'view'), getSingleVendor);
router.post('/', protect, authorize('vendor', 'create'), createVendor);
router.put('/:id', protect, authorize('vendor', 'update'), updateVendor);
router.delete('/:id', protect, authorize('vendor', 'delete'), deleteVendor);

module.exports = router;
