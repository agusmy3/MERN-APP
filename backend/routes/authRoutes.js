const express = require('express');
const { login, me, updateTheme } = require('../controllers/authController');
const protect = require('../middlewares/authMiddleware');

const router = express.Router();

// POST /register sengaja dihapus: registrasi publik dimatikan, user dibuat admin via /api/user
router.post('/login', login);
router.get('/me', protect, me);
router.put('/theme', protect, updateTheme);

module.exports = router;
