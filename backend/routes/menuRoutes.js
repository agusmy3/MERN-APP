const express = require('express');
const router = express.Router();
const {
  getAllMenu,
  getHierarchy,
  getMenuTree,
  createMenu,
  updateMenu,
  deleteMenu
} = require ('../controllers/menuController');

const protect = require('../middlewares/authMiddleware');

router.get("/", protect, getAllMenu);
router.get("/getHierarchy", protect, getHierarchy);
router.get("/tree", getMenuTree);
router.post("/", protect, createMenu);
router.put("/:id", protect, updateMenu);
router.delete("/:id", protect, deleteMenu);

module.exports = router;
