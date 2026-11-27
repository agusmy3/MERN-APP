const mongoose = require('mongoose');

/**
 * Penjualan langsung (barang keluar + invoice dalam 1 dokumen), 1 dokumen = 1 gudang:
 *   DRAFT --post--> POSTED --cancel--> CANCELLED
 * Draft bisa diedit/dihapus tanpa mengubah stok.
 *
 * - post   : movement SALE (-qty) di gudang; HPP saat itu disimpan per baris (unitCost) -> cogs & laba kotor
 * - cancel : movement pembalik (+qty) dengan unitCost yang sama
 * qty = satuan dasar (stok); qtyUom / hargaJual = satuan jual (kemasan, lihat helpers/packageHelper.js). Pajak (salinan System Settings saat dokumen dibuat):
 * - priceIncludesTax = false : dpp = subtotal - diskon dokumen, PPN = dpp x tarif, total = dpp + PPN
 * - priceIncludesTax = true  : total = subtotal - diskon dokumen, PPN = total x tarif / (100 + tarif), dpp = total - PPN
 * Pendapatan bersih = dpp (tanpa PPN, barang saja); laba kotor = dpp - cogs. Ongkir terpisah (shipping*).
 * Lihat helpers/salesHelper.js.
 */
const lineSchema = new mongoose.Schema({
  sku: { type: mongoose.Schema.Types.ObjectId, ref: 'ProdukSku', required: true },
  produk: { type: mongoose.Schema.Types.ObjectId, ref: 'Produk', required: true },
  qty: { type: Number, required: true },
  uom: { type: mongoose.Schema.Types.ObjectId, ref: 'Uom', default: null }, // satuan jual (null = satuan dasar, data lama)
  konversi: { type: Number, default: 1 },        // isi satuan jual dalam satuan dasar
  qtyUom: { type: Number, default: null },       // qty dalam satuan jual (null = qty); qty = satuan dasar
  hargaJual: { type: Number, required: true },   // per satuan jual
  diskonPersen: { type: Number, default: 0 },
  subtotal: { type: Number, required: true },         // qtyUom x harga x (1 - diskon%)
  unitCost: { type: Number, default: null },          // HPP saat post (data biaya)
  qtyReturned: { type: Number, default: 0 },          // total retur POSTED (Sales Return), satuan dasar
  note: { type: String },
});  // _id per baris: dirujuk surat jalan (soLine) / retur (invoiceLine)

const soAllocationSchema = new mongoose.Schema({
  salesOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'SalesOrder', required: true },
  subtotal: { type: Number, default: 0 },
  discountAmount: { type: Number, default: 0 },
  shippingCharge: { type: Number, default: 0 },
}, { _id: false });

const salesInvoiceSchema = new mongoose.Schema({
  no: { type: String, required: true, unique: true },  // INV-202611-0001 (POS: POS-202611-0001)
  // BACKOFFICE = invoice langsung; POS = kasir; SALES_ORDER = tagihan atas 1 / beberapa Delivery Order (stok keluar di DO)
  source: { type: String, enum: ['BACKOFFICE', 'POS', 'SALES_ORDER'], default: 'BACKOFFICE' },
  // SALES_ORDER: surat jalan yang ditagih (customer & gudang sama; boleh dari beberapa SO) + SO-nya
  salesOrders: [{ type: mongoose.Schema.Types.ObjectId, ref: 'SalesOrder' }],
  deliveryOrders: [{ type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryOrder' }],
  // porsi per SO: subtotal barang, diskon dokumen SO yang dibebankan, ongkir SO (hanya invoice pertama SO tsb)
  soAllocations: [soAllocationSchema],
  outlet: { type: mongoose.Schema.Types.ObjectId, ref: 'Outlet', default: null },   // POS
  shift: { type: mongoose.Schema.Types.ObjectId, ref: 'PosShift', default: null },  // POS
  cashTendered: { type: Number, default: null },  // POS: uang tunai diterima
  change: { type: Number, default: null },        // POS: kembalian
  voidApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // POS: void disetujui supervisor
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
  gudang: { type: mongoose.Schema.Types.ObjectId, ref: 'Gudang', required: true },
  date: { type: Date, required: true },
  status: { type: String, required: true, enum: ['DRAFT', 'POSTED', 'CANCELLED'], default: 'DRAFT' },
  priceIncludesTax: { type: Boolean, default: false },
  taxRate: { type: Number, default: 0 },
  lines: { type: [lineSchema], default: [] },
  subtotal: { type: Number, default: 0 },
  discountAmount: { type: Number, default: 0 },        // diskon dokumen (nominal)
  dpp: { type: Number, default: 0 },                   // dasar pengenaan pajak = pendapatan bersih
  taxAmount: { type: Number, default: 0 },
  total: { type: Number, default: 0 },                 // total barang + ongkir (termasuk PPN)
  // ongkir yang ditagih ke customer (SALES_ORDER: invoice pertama dari SO); tidak termasuk penjualan barang
  shippingCharge: { type: Number, default: 0 },        // nominal (mode pajak sama dengan harga)
  shippingDpp: { type: Number, default: 0 },           // tanpa PPN
  shippingTotal: { type: Number, default: 0 },         // termasuk PPN
  cogs: { type: Number, default: null },               // HPP penjualan, diisi saat post (data biaya)
  // piutang (helpers/salesHelper.js invoiceBalance): sisa = total - returnedAmount - paidAmount - writtenOffAmount
  dueDate: { type: Date, default: null },
  returnedAmount: { type: Number, default: 0 },        // nilai retur POSTED (termasuk PPN)
  paidAmount: { type: Number, default: 0 },            // pembayaran POSTED dikurangi refund
  writtenOffAmount: { type: Number, default: 0 },      // potongan / penghapusan saat pembayaran (bukan uang masuk)
  paymentStatus: { type: String, enum: ['UNPAID', 'PARTIAL', 'PAID', 'OVERPAID', null], default: null }, // null = belum diposting
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

salesInvoiceSchema.index({ status: 1, date: -1 });
salesInvoiceSchema.index({ gudang: 1, status: 1 });
salesInvoiceSchema.index({ customer: 1 });
salesInvoiceSchema.index({ shift: 1 });
salesInvoiceSchema.index({ salesOrders: 1 });
salesInvoiceSchema.index({ deliveryOrders: 1 });
salesInvoiceSchema.index({ outlet: 1, date: -1 });
salesInvoiceSchema.index({ status: 1, paymentStatus: 1, dueDate: 1 });
salesInvoiceSchema.index({ 'lines.sku': 1 });

module.exports = mongoose.model('SalesInvoice', salesInvoiceSchema);
