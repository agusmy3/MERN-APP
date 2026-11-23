const mongoose = require('mongoose');

/**
 * Purchase Order ke vendor. TIDAK mengubah stok (stok bertambah lewat GoodsReceipt).
 *   DRAFT --issue--> OPEN --GR--> PARTIAL --GR--> RECEIVED
 *                     |             |
 *                     +- cancel     +- close (sisa tidak akan datang)
 * Hanya DRAFT yang bisa diedit/dihapus. PO yang sudah terbit: batalkan lalu buat ulang.
 *
 * Harga & konversi DISALIN dari VendorPrice saat diisi; isPKP & taxRate disalin dari System Settings
 * saat diterbitkan, jadi perubahan harga vendor / setting tidak mengubah PO lama.
 */
const lineSchema = new mongoose.Schema({
  sku: { type: mongoose.Schema.Types.ObjectId, ref: 'ProdukSku', required: true },
  produk: { type: mongoose.Schema.Types.ObjectId, ref: 'Produk', required: true },
  uomBeli: { type: mongoose.Schema.Types.ObjectId, ref: 'Uom', required: true },
  konversi: { type: Number, required: true },    // 1 uomBeli = konversi satuan dasar
  qty: { type: Number, required: true },         // dalam uomBeli
  hargaBeli: { type: Number, required: true },   // per uomBeli, sebelum diskon & pajak
  diskonPersen: { type: Number, default: 0 },
  subtotal: { type: Number, required: true },    // qty x harga x (1 - diskon)
  qtyReceived: { type: Number, default: 0 },     // dalam uomBeli, dari GR yang POSTED
  note: { type: String },
});

const purchaseOrderSchema = new mongoose.Schema({
  no: { type: String, required: true, unique: true },       // PO-202611-0001 (diberikan saat dibuat)
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
  gudang: { type: mongoose.Schema.Types.ObjectId, ref: 'Gudang', required: true }, // gudang tujuan
  date: { type: Date, required: true },
  expectedDate: { type: Date, default: null },
  status: { type: String, required: true, enum: ['DRAFT', 'OPEN', 'PARTIAL', 'RECEIVED', 'CLOSED', 'CANCELLED'], default: 'DRAFT' },
  isPKP: { type: Boolean, default: true },                   // snapshot setting tax.isPKP
  taxRate: { type: Number, default: 0 },                     // % PPN (0 = vendor non-PKP)
  lines: { type: [lineSchema], default: [] },
  subtotal: { type: Number, default: 0 },
  taxAmount: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  note: { type: String },
  issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  issuedDate: { type: Date, default: null },
  closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  closedDate: { type: Date, default: null },
  closeReason: { type: String, default: null },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  cancelledDate: { type: Date, default: null },
  cancelReason: { type: String, default: null },
  createdDate: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedDate: { type: Date, default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null, ref: 'User' }
});

purchaseOrderSchema.index({ status: 1, createdDate: -1 });
purchaseOrderSchema.index({ vendor: 1, date: -1 });
purchaseOrderSchema.index({ 'lines.sku': 1 });
purchaseOrderSchema.index({ gudang: 1 });

module.exports = mongoose.model('PurchaseOrder', purchaseOrderSchema);
