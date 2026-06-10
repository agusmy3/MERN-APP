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

const protect = require('../middlewares/authMiddleware');

router.get("/all", protect, getAllMenu);
router.get("/", protect, getMenu);
router.get("/getHierarchy", protect, getHierarchy);
router.get("/tree", getMenuTree);
router.post("/", protect, createMenu);
router.put("/:id", protect, updateMenu);
router.delete("/:id", protect, deleteMenu);

module.exports = router;
