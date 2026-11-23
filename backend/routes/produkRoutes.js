const express = require('express');
const router = express.Router();
const {
  getAllProduk,
  getProduk,
  getSingleProduk,
  createProduk,
  updateProduk,
  deleteProduk
} = require('../controllers/produkController');
const {
  listSku,
  generateSku,
  bulkUpdateSku,
  deleteSku
} = require('../controllers/produkSkuController');
const Produk = require('../models/Produk');
const protect = require('../middlewares/authMiddleware');
const authorize = require('../middlewares/authorize');
const { dropdownHandler } = require('../helpers/dropdownHelper');

// Izin: view = lihat/cari/detail, create/update/delete sesuai operasi (lihat config/permissions.js)
// /dropdown cukup login: untuk pilihan di form resource lain, hanya field ringkas
router.get('/dropdown', protect, dropdownHandler(Produk, '_id name', { name: 1 }));
router.get('/all', protect, authorize('produk', 'view'), getAllProduk);
router.get('/', protect, authorize('produk', 'view'), getProduk);
router.get('/:id', protect, authorize('produk', 'view'), getSingleProduk);
router.post('/', protect, authorize('produk', 'create'), createProduk);
router.put('/:id', protect, authorize('produk', 'update'), updateProduk);
router.delete('/:id', protect, authorize('produk', 'delete'), deleteProduk);

// SKU (varian produk): mengelola SKU = mengubah produk -> butuh izin produk:update
router.get('/:id/sku', protect, authorize('produk', 'view'), listSku);
router.post('/:id/sku/generate', protect, authorize('produk', 'update'), generateSku);
router.put('/:id/sku', protect, authorize('produk', 'update'), bulkUpdateSku);
router.delete('/:id/sku/:skuId', protect, authorize('produk', 'update'), deleteSku);

module.exports = router;
