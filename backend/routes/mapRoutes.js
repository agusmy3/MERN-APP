const express = require('express');
const router = express.Router();
const protect = require('../middlewares/authMiddleware');
const authorize = require('../middlewares/authorize');
const { getPoints, getSummary } = require('../controllers/mapController');

// Peta lokasi: map:view; isi tiap lapisan & ringkasan tetap disaring izin resource-nya di controller
router.get('/points', protect, authorize('map', 'view'), getPoints);
router.get('/summary/:type/:id', protect, authorize('map', 'view'), getSummary);

module.exports = router;
