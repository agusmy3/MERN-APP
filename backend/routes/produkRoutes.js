const express = require('express');
const router = express.Router();
const {
  getAllProduk,
  createProduk,
  updateProduk,
  deleteProduk
} = require('../controllers/produkController');
const protect = require('../middlewares/authMiddleware');

router.get('/', protect, getAllProduk);
router.post('/', protect, createProduk);
router.put('/:id', protect, updateProduk);
router.delete('/:id', protect, deleteProduk);

module.exports = router;
