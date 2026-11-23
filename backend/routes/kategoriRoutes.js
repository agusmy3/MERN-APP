const express = require('express');
const router = express.Router();
const {
  getAllKategori,
  getKategori,
  getSingleKategori,
  createKategori,
  updateKategori,
  deleteKategori
} = require('../controllers/kategoriController');
const Kategori = require('../models/Kategori');
const protect = require('../middlewares/authMiddleware');
const authorize = require('../middlewares/authorize');
const { dropdownHandler } = require('../helpers/dropdownHelper');

// Izin: view = lihat/cari/detail, create/update/delete sesuai operasi (lihat config/permissions.js)
// /dropdown cukup login: untuk pilihan di form resource lain, hanya field ringkas
router.get('/dropdown', protect, dropdownHandler(Kategori, '_id name', { name: 1 }));
router.get('/all', protect, authorize('kategori', 'view'), getAllKategori);
router.get('/', protect, authorize('kategori', 'view'), getKategori);
router.get('/:id', protect, authorize('kategori', 'view'), getSingleKategori);
router.post('/', protect, authorize('kategori', 'create'), createKategori);
router.put('/:id', protect, authorize('kategori', 'update'), updateKategori);
router.delete('/:id', protect, authorize('kategori', 'delete'), deleteKategori);

module.exports = router;
