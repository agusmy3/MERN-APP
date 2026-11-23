const express = require('express');
const router = express.Router();
const protect = require('../middlewares/authMiddleware');
const authorize = require('../middlewares/authorize');
const { getSettings, updateSettings } = require('../controllers/settingController');

// Baca cukup login (nilai dipakai form lain, mis. tarif PPN di PO). Halaman Settings butuh setting:view.
router.get('/', protect, getSettings);
router.put('/', protect, authorize('setting', 'update'), updateSettings);

module.exports = router;
