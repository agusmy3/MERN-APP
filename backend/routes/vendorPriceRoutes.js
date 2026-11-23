const express = require('express');
const router = express.Router();
const {
  getVendorPrice,
  createVendorPrice,
  updateVendorPrice,
  deleteVendorPrice
} = require('../controllers/vendorPriceController');
const protect = require('../middlewares/authMiddleware');
const authorize = require('../middlewares/authorize');

// Harga beli = data sensitif: resource izin sendiri ('vendorPrice'), terpisah dari 'produk'
router.get('/', protect, authorize('vendorPrice', 'view'), getVendorPrice);
router.post('/', protect, authorize('vendorPrice', 'create'), createVendorPrice);
router.put('/:id', protect, authorize('vendorPrice', 'update'), updateVendorPrice);
router.delete('/:id', protect, authorize('vendorPrice', 'delete'), deleteVendorPrice);

module.exports = router;
