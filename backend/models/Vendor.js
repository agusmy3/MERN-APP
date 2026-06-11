const mongoose = require('mongoose');

const vendorSchema = new mongoose.Schema({
    companyName: { type: String, required: true },
    picName: { type: String, required: true },
    picContact: { type: String, required: true },
    companyAddress: { type: String, required: true },
    createdDate: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedDate: { type: Date },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
});

module.exports = mongoose.model('Vendor', vendorSchema);
