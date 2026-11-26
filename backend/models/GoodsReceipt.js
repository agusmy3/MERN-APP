const mongoose = require('mongoose');

/**
 * Penerimaan barang dari PO (wajib ada PO). 1 PO bisa diterima bertahap (banyak GR).
 *   DRAFT --post--> POSTED --cancel--> CANCELLED
 * Post: stok gudang PO bertambah (movement PURCHASE + unitCost), HPP rata-rata dihitung ulang,
 * qtyReceived di PO bertambah. Cancel: semuanya dibalik (movement pembalik), tidak ada yang dihapus.
 *
 * Data baris disalin dari baris PO. unitCost = harga net per satuan dasar
 * = harga x (1 - diskon) [x (1 + PPN) jika perusahaan bukan PKP] / konversi.
 */
const lineSchema = new mongoose.Schema({
  poLine: { type: mongoose.Schema.Types.ObjectId, required: true }, // _id baris PO
  sku: { type: mongoose.Schema.Types.ObjectId, ref: 'ProdukSku', required: true },
  produk: { type: mongoose.Schema.Types.ObjectId, ref: 'Produk', required: true },
  uomBeli: { type: mongoose.Schema.Types.ObjectId, ref: 'Uom', required: true },
  konversi: { type: Number, required: true },
  qty: { type: Number, required: true },        // diterima, dalam uomBeli
  qtyBase: { type: Number, required: true },    // qty x konversi (masuk stok)
  baseUnitCost: { type: Number, default: null },  // HPP dari harga PO saja, per satuan dasar
  freightCost: { type: Number, default: 0 },      // bagian biaya angkut baris ini (total, bukan per unit)
  unitCost: { type: Number, required: true },   // per satuan dasar (HPP masuk = base + angkut / qtyBase)
  note: { type: String },
}, { _id: false });

const goodsReceiptSchema = new mongoose.Schema({
  no: { type: String, required: true, unique: true },          // GR-202611-0001
  purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true },
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true }, // disalin dari PO
  gudang: { type: mongoose.Schema.Types.ObjectId, ref: 'Gudang', required: true }, // disalin dari PO
  date: { type: Date, required: true },
  deliveryNoteNo: { type: String },                             // no. surat jalan vendor
  // biaya angkut / ekspedisi penerimaan ini (tanpa PPN yang bisa dikreditkan): dibagi ke baris menurut nilai,
  // menambah HPP. Hanya diisi / dilihat user dengan vendorPrice:view.
  freightCharge: { type: Number, default: 0 },
  freightNote: { type: String, default: '' },
  status: { type: String, required: true, enum: ['DRAFT', 'POSTED', 'CANCELLED'], default: 'DRAFT' },
  lines: { type: [lineSchema], default: [] },
  note: { type: String },
  postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  postedDate: { type: Date, default: null },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  cancelledDate: { type: Date, default: null },
  cancelReason: { type: String, default: null },
  createdDate: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedDate: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'User' }
});

goodsReceiptSchema.index({ purchaseOrder: 1, status: 1 });
goodsReceiptSchema.index({ status: 1, createdDate: -1 });
goodsReceiptSchema.index({ 'lines.sku': 1 });

module.exports = mongoose.model('GoodsReceipt', goodsReceiptSchema);
