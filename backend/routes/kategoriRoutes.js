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
const protect = require('../middlewares/authMiddleware');

router.get('/all', protect, getAllKategori);
router.get('/', protect, getKategori);
router.get('/:id', protect, getSingleKategori);
router.post('/', protect, createKategori);
router.put('/:id', protect, updateKategori);
router.delete('/:id', protect, deleteKategori);

module.exports = router;
