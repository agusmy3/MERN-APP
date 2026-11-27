const mongoose = require('mongoose');

/**
 * Tagihan vendor (BILL-…): hutang atas barang yang sudah diterima (Goods Receipt) + biaya angkut.
 * Dibuat langsung POSTED dari 1 / beberapa GR POSTED vendor yang sama (TIDAK mengubah stok), batal = CANCELLED.
 * Harga DIKUNCI = harga PO (diskon & PPN PO); qty = qty GR - yang sudah diretur saat ditagih.
 * Biaya angkut GR ditagih oleh GR.freightVendor (boleh vendor ekspedisi lain), tanpa PPN tambahan.
 * Sisa hutang = total - returnedAmount (retur setelah ditagih) - paidAmount (pembayaran vendor bersih) - writtenOffAmount (potongan).
 */
const lineSchema = new mongoose.Schema({
  goodsReceipt: { type: mongoose.Schema.Types.ObjectId, ref: 'GoodsReceipt', required: true },
  poLine: { type: mongoose.Schema.Types.ObjectId, required: true },
  sku: { type: mongoose.Schema.Types.ObjectId, ref: 'ProdukSku', required: true },
  produk: { type: mongoose.Schema.Types.ObjectId, ref: 'Produk', required: true },
  uomBeli: { type: mongoose.Schema.Types.ObjectId, ref: 'Uom', required: true },
  qty: { type: Number, required: true },          // satuan beli
  hargaBeli: { type: Number, required: true },
  diskonPersen: { type: Number, default: 0 },
  subtotal: { type: Number, required: true },
}, { _id: false });

const chargeSchema = new mongoose.Schema({
  goodsReceipt: { type: mongoose.Schema.Types.ObjectId, ref: 'GoodsReceipt', required: true },
  description: { type: String, default: '' },
  amount: { type: Number, required: true },
}, { _id: false });

const purchaseInvoiceSchema = new mongoose.Schema({
  no: { type: String, required: true, unique: true },          // BILL-202611-0001
  vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
  vendorInvoiceNo: { type: String, default: '' },              // no. faktur vendor
  date: { type: Date, required: true },                        // tanggal faktur
  dueDate: { type: Date, required: true },
  goodsReceipts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'GoodsReceipt' }],   // barang
  freightReceipts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'GoodsReceipt' }], // biaya angkut
  gudangs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Gudang' }],               // dari GR (akses gudang)
  status: { type: String, enum: ['POSTED', 'CANCELLED'], default: 'POSTED' },
  taxRate: { type: Number, default: 0 },
  lines: [lineSchema],
  charges: [chargeSchema],
  subtotal: { type: Number, default: 0 },       // barang setelah diskon baris
  taxAmount: { type: Number, default: 0 },      // PPN barang
  freightTotal: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  returnedAmount: { type: Number, default: 0 }, // retur pembelian setelah ditagih (nota debit)
  paidAmount: { type: Number, default: 0 },     // pembayaran - refund
  writtenOffAmount: { type: Number, default: 0 }, // potongan dari vendor saat pembayaran (bukan uang keluar)
  paymentStatus: { type: String, enum: ['UNPAID', 'PARTIAL', 'PAID', 'OVERPAID', null], default: 'UNPAID' },
  note: { type: String, default: '' },
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

purchaseInvoiceSchema.index({ vendor: 1, status: 1 });
purchaseInvoiceSchema.index({ status: 1, paymentStatus: 1, dueDate: 1 });
purchaseInvoiceSchema.index({ goodsReceipts: 1 });
purchaseInvoiceSchema.index({ freightReceipts: 1 });
purchaseInvoiceSchema.index({ date: -1 });

module.exports = mongoose.model('PurchaseInvoice', purchaseInvoiceSchema);
