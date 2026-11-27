const express = require('express');
const router = express.Router();
const protect = require('../middlewares/authMiddleware');
const { listRegions, searchRegions, getRegion } = require('../controllers/regionController');

// Data referensi publik (wilayah Kemendagri) untuk form lokasi semua resource: cukup login, seperti /dropdown.
router.get('/', protect, listRegions);
router.get('/search', protect, searchRegions);
router.get('/:kode', protect, getRegion);

module.exports = router;
