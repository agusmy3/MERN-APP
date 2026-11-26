const mongoose = require('mongoose');
const { shipToSchema } = require('./SalesOrder');

/**
 * Delivery Order / surat jalan: pengiriman (atau pengambilan) barang atas 1 Sales Order OPEN / PARTIAL.
 *   DRAFT --post--> POSTED --cancel--> CANCELLED
 * Post = stok keluar (movement SALE) dari gudang SO, HPP saat itu disimpan per baris; qtyDelivered SO bertambah.
 * Qty <= sisa SO (dicek lagi saat post). 1 DO ditagih dengan 1 invoice (`invoice`); DO yang sudah ditagih
 * tidak bisa dibatalkan (batalkan invoice-nya dulu).
 */
const lineSchema = new mongoose.Schema({
  sku: { type: mongoose.Schema.Types.ObjectId, ref: 'ProdukSku', required: true },
  produk: { type: mongoose.Schema.Types.ObjectId, ref: 'Produk', required: true },
  soLine: { type: mongoose.Schema.Types.ObjectId, default: null }, // _id baris SO (kemasan sama dengan SO)
  uom: { type: mongoose.Schema.Types.ObjectId, ref: 'Uom', default: null }, // satuan jual baris SO
  konversi: { type: Number, default: 1 },
  qtyUom: { type: Number, default: null },     // qty dalam satuan jual (null = qty)
  qty: { type: Number, required: true },        // satuan dasar
  unitCost: { type: Number, default: null },    // HPP saat post (data biaya)
  note: { type: String },
}, { _id: false });

const deliveryOrderSchema = new mongoose.Schema({
  no: { type: String, required: true, unique: true },   // DO-202611-0001
  salesOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'SalesOrder', required: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },  // salinan SO
  gudang: { type: mongoose.Schema.Types.ObjectId, ref: 'Gudang', required: true },      // salinan SO
  date: { type: Date, required: true },
  deliveryMethod: { type: String, enum: ['DELIVERY', 'PICKUP'], default: 'DELIVERY' },   // salinan SO
  shipTo: { type: shipToSchema, default: () => ({}) },                                    // salinan SO
  // dikirim: kendaraan / sopir / kurir & no. resi; diambil sendiri: nama pengambil
  vehicleNo: { type: String, default: '' },
  driverName: { type: String, default: '' },
  courier: { type: String, default: '' },
  trackingNo: { type: String, default: '' },
  pickedUpBy: { type: String, default: '' },
  status: { type: String, required: true, enum: ['DRAFT', 'POSTED', 'CANCELLED'], default: 'DRAFT' },
  lines: { type: [lineSchema], default: [] },
  invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'SalesInvoice', default: null }, // invoice aktif (bukan CANCELLED)
  note: { type: String },
  postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  postedDate: { type: Date, default: null },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  cancelledDate: { type: Date, default: null },
  cancelReason: { type: String, default: null },
  createdDate: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedDate: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'User' },
});

deliveryOrderSchema.index({ salesOrder: 1 });
deliveryOrderSchema.index({ status: 1, date: -1 });
deliveryOrderSchema.index({ gudang: 1, status: 1 });
deliveryOrderSchema.index({ customer: 1 });
deliveryOrderSchema.index({ 'lines.sku': 1 });

module.exports = mongoose.model('DeliveryOrder', deliveryOrderSchema);
