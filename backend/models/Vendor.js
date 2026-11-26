const mongoose = require('mongoose');

const vendorSchema = new mongoose.Schema({
    companyName: { type: String, required: true },
    picName: { type: String, required: true },
    picContact: { type: String, required: true },
    companyAddress: { type: String, required: true },   // alamat jalan
    // wilayah & koordinat (validasi bersama Gudang/Outlet: helpers/locationHelper.js)
    provinsi: { type: String, trim: true, default: '' },
    kota: { type: String, trim: true, default: '' },        // kota / kabupaten
    kecamatan: { type: String, trim: true, default: '' },
    kodePos: { type: String, trim: true, default: '' },     // 5 digit
    latitude: { type: Number, default: null, min: -90, max: 90 },
    longitude: { type: Number, default: null, min: -180, max: 180 },
    createdDate: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedDate: { type: Date },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
});

module.exports = mongoose.model('Vendor', vendorSchema);
