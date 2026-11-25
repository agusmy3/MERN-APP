const mongoose = require('mongoose');

/**
 * Retur penjualan atas 1 Sales Invoice POSTED (gudang = gudang invoice):
 *   DRAFT --post--> POSTED --cancel--> CANCELLED
 * - post   : movement SALE_RETURN (+qty) dengan HPP saat dijual (unitCost baris invoice);
 *            invoice.lines.qtyReturned & invoice.returnedAmount bertambah (tagihan berkurang)
 * - cancel : pembalik (-qty, stok harus cukup) dengan unitCost yang sama
 * Qty retur <= terjual - sudah diretur (dicek lagi saat post). Barang rusak tetap masuk stok dulu,
 * lalu dikeluarkan lewat Stock Adjustment (alasan Damaged).
 * Nilai per baris dibagi proporsional seperti invoice (helpers/salesHelper.js returnLineValues):
 *   amount = mengurangi tagihan (termasuk PPN), netAmount = mengurangi penjualan bersih (dpp).
 */
const lineSchema = new mongoose.Schema({
  sku: { type: mongoose.Schema.Types.ObjectId, ref: 'ProdukSku', required: true },
  produk: { type: mongoose.Schema.Types.ObjectId, ref: 'Produk', required: true },
  qty: { type: Number, required: true },
  subtotal: { type: Number, default: 0 },      // harga bersih baris invoice x qty
  amount: { type: Number, default: 0 },        // termasuk PPN (proporsional invoice)
  netAmount: { type: Number, default: 0 },     // dpp
  unitCost: { type: Number, default: null },   // HPP saat dijual (data biaya)
  note: { type: String },
}, { _id: false });

const salesReturnSchema = new mongoose.Schema({
  no: { type: String, required: true, unique: true },  // RTN-202611-0001
  salesInvoice: { type: mongoose.Schema.Types.ObjectId, ref: 'SalesInvoice', required: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  gudang: { type: mongoose.Schema.Types.ObjectId, ref: 'Gudang', required: true },
  date: { type: Date, required: true },
  reason: { type: String, required: true },
  status: { type: String, required: true, enum: ['DRAFT', 'POSTED', 'CANCELLED'], default: 'DRAFT' },
  lines: { type: [lineSchema], default: [] },
  subtotal: { type: Number, default: 0 },
  dpp: { type: Number, default: 0 },
  taxAmount: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  cogs: { type: Number, default: null },
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

salesReturnSchema.index({ status: 1, date: -1 });
salesReturnSchema.index({ salesInvoice: 1 });
salesReturnSchema.index({ gudang: 1, status: 1 });
salesReturnSchema.index({ 'lines.sku': 1 });

module.exports = mongoose.model('SalesReturn', salesReturnSchema);
