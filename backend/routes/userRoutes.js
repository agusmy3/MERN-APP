const express = require('express');
const router = express.Router();
const {
  getUser,
  getSingleUser,
  createUser,
  updateUser,
  deleteUser
} = require('../controllers/userController');
const protect = require('../middlewares/authMiddleware');
const authorize = require('../middlewares/authorize');

router.get('/', protect, authorize('user', 'view'), getUser);
router.get('/:id', protect, authorize('user', 'view'), getSingleUser);
router.post('/', protect, authorize('user', 'create'), createUser);
router.put('/:id', protect, authorize('user', 'update'), updateUser);
router.delete('/:id', protect, authorize('user', 'delete'), deleteUser);

module.exports = router;
