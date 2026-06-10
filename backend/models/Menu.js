const mongoose = require('mongoose');

const menuSchema = new mongoose.Schema({
  menu: { type: String, required: true },
  parent_id: { type: mongoose.Schema.Types.ObjectId, ref: "Menu", default: null },
  component: { type: String, default: null }, // path komponen tujuan
  img: { type: String, default: null },
  icon: { type: String, default: null },
  createdDate: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  updatedDate: { type: Date },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
});

module.exports = mongoose.model('Menu', menuSchema);
