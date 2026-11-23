const express = require('express');
const router = express.Router();
const {
  getAllMenu,
  getMenu,
  getHierarchy,
  getMenuTree,
  createMenu,
  updateMenu,
  deleteMenu
} = require ('../controllers/menuController');
const Menu = require('../models/Menu');
const protect = require('../middlewares/authMiddleware');
const authorize = require('../middlewares/authorize');
const { dropdownHandler } = require('../helpers/dropdownHelper');

// /tree: sidebar, cukup login & sudah disaring sesuai izin user (sebelumnya tanpa auth)
router.get("/tree", protect, getMenuTree);
// /dropdown: pilihan Parent di form Menu (parent_id dipakai untuk menampilkan hierarki)
router.get("/dropdown", protect, dropdownHandler(Menu, '_id menu parent_id', { menu: 1 }));
router.get("/all", protect, authorize('menu', 'view'), getAllMenu);
router.get("/getHierarchy", protect, authorize('menu', 'view'), getHierarchy);
router.get("/", protect, authorize('menu', 'view'), getMenu);
router.post("/", protect, authorize('menu', 'create'), createMenu);
router.put("/:id", protect, authorize('menu', 'update'), updateMenu);
router.delete("/:id", protect, authorize('menu', 'delete'), deleteMenu);

module.exports = router;
