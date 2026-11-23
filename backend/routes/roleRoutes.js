const express = require('express');
const router = express.Router();
const {
  getResources,
  getRole,
  getSingleRole,
  createRole,
  updateRole,
  deleteRole
} = require('../controllers/roleController');
const Role = require('../models/Role');
const protect = require('../middlewares/authMiddleware');
const authorize = require('../middlewares/authorize');
const { dropdownHandler } = require('../helpers/dropdownHelper');

// cukup login: daftar resource dipakai matriks Role & pilihan Resource di form Menu
router.get('/resources', protect, getResources);
router.get('/dropdown', protect, dropdownHandler(Role, '_id name', { name: 1 }));
router.get('/', protect, authorize('role', 'view'), getRole);
router.get('/:id', protect, authorize('role', 'view'), getSingleRole);
router.post('/', protect, authorize('role', 'create'), createRole);
router.put('/:id', protect, authorize('role', 'update'), updateRole);
router.delete('/:id', protect, authorize('role', 'delete'), deleteRole);

module.exports = router;
