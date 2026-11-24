const express = require('express');
const router = express.Router();
const protect = require('../middlewares/authMiddleware');
const { getDashboard } = require('../controllers/dashboardController');

// Cukup login: isi widget disaring sesuai izin user di controller
router.get('/', protect, getDashboard);

module.exports = router;
