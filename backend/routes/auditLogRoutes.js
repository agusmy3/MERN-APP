const express = require('express');
const router = express.Router();
const { getHistory, getAuditLogs } = require('../controllers/auditLogController');
const protect = require('../middlewares/authMiddleware');
const authorize = require('../middlewares/authorize');

// Hanya baca: audit log tidak bisa diubah/dihapus lewat API.
// /history: izin dicek di controller sesuai resource record-nya (produk/role/user)
router.get('/history', protect, getHistory);
router.get('/', protect, authorize('auditLog', 'view'), getAuditLogs);

module.exports = router;
