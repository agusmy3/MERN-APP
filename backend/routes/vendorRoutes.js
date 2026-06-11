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
const protect = require('../middlewares/authMiddleware');

router.get('/all', protect, getAllVendor);
router.get('/', protect, getVendor);
router.get('/:id', protect, getSingleVendor);
router.post('/', protect, createVendor);
router.put('/:id', protect, updateVendor);
router.delete('/:id', protect, deleteVendor);

module.exports = router;
