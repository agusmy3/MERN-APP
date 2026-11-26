/**
 * Audit Log per gudang: isi `gudangs` pada log lama dokumen per gudang (stok, transfer, PO/GR, penjualan, POS, ...)
 * dari dokumennya (atau snapshot untuk log hapus). Aman dijalankan berulang (hanya log yang belum punya `gudangs`).
 *   cd backend && npm run migrate:audit-gudang
 * Sebelum dijalankan, log lama tidak terikat gudang -> terlihat oleh semua user yang boleh melihat entity-nya.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const mongoose = require('mongoose');

// entity log -> model dokumen
const MODEL_OF = {
  gudang: 'Gudang', outlet: 'Outlet', stockAdjustment: 'StockAdjustment', stockTransfer: 'StockTransfer',
  purchaseOrder: 'PurchaseOrder', goodsReceipt: 'GoodsReceipt', purchaseReturn: 'PurchaseReturn', purchaseInvoice: 'PurchaseInvoice',
  vendorPayment: 'VendorPayment', vendorPaymentBatch: 'VendorPaymentBatch', quotation: 'Quotation', salesOrder: 'SalesOrder',
  deliveryOrder: 'DeliveryOrder', salesInvoice: 'SalesInvoice', salesReturn: 'SalesReturn', salesPayment: 'SalesPayment',
  customerReceipt: 'CustomerReceipt', posShift: 'PosShift', reorderRule: 'ReorderRule',
};

/** -> jumlah log yang diisi */
const migrateAuditGudang = async () => {
  for (const name of new Set(Object.values(MODEL_OF))) require(`../models/${name}`);
  const { gudangsOf } = require('../helpers/auditLogger');
  const col = mongoose.connection.db.collection('auditlogs'); // AuditLog menolak update lewat model
  let count = 0;
  for (const [entity, modelName] of Object.entries(MODEL_OF)) {
    const logs = await col.find({ entity, gudangs: { $exists: false } }).project({ entityId: 1, snapshot: 1 }).toArray();
    if (!logs.length) continue;
    const ids = [...new Set(logs.map((l) => String(l.entityId)).filter((id) => mongoose.isValidObjectId(id)))];
    const docs = new Map((await mongoose.model(modelName).find({ _id: { $in: ids } }).lean()).map((d) => [String(d._id), d]));
    const cache = new Map();
    for (const log of logs) {
      const raw = docs.get(String(log.entityId)) || log.snapshot;
      const key = String(log.entityId);
      if (!cache.has(key)) cache.set(key, raw ? await gudangsOf(entity, raw) : []);
      await col.updateOne({ _id: log._id }, { $set: { gudangs: cache.get(key) || [] } });
      count += 1;
    }
  }
  return count;
};

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(`[+] ${await migrateAuditGudang()} log diberi gudang`);
}

if (require.main === module) {
  main()
    .then(() => mongoose.disconnect())
    .catch(async (err) => {
      console.error(err);
      await mongoose.disconnect();
      process.exit(1);
    });
}

module.exports = { migrateAuditGudang };
