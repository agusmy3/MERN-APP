/**
 * Invoice dari surat jalan: field lama `salesOrder` / `deliveryOrder` (1 DO per invoice) -> daftar
 * `salesOrders` / `deliveryOrders` + `soAllocations` (porsi diskon & ongkir per SO). Aman dijalankan berulang.
 *   cd backend && npm run migrate:invoice-deliveries
 *
 * Wajib dijalankan sekali pada database yang sudah punya invoice dari Delivery Order (sebelum fitur
 * invoice gabungan). Database baru (npm run init) tidak perlu.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const mongoose = require('mongoose');

/** Migrasi koleksi salesinvoices (lewat driver, karena field lama sudah tidak ada di schema). -> jumlah invoice */
const migrateInvoiceDeliveries = async (db = mongoose.connection.db) => {
  const col = db.collection('salesinvoices');
  const old = await col.find({ $or: [{ salesOrder: { $exists: true } }, { deliveryOrder: { $exists: true } }] })
    .project({ salesOrder: 1, deliveryOrder: 1, subtotal: 1, discountAmount: 1, shippingCharge: 1, salesOrders: 1, deliveryOrders: 1, soAllocations: 1 })
    .toArray();
  for (const inv of old) {
    const set = {};
    if (inv.salesOrder && !(inv.salesOrders || []).length) {
      set.salesOrders = [inv.salesOrder];
      set.soAllocations = [{
        salesOrder: inv.salesOrder,
        subtotal: inv.subtotal || 0,
        discountAmount: inv.discountAmount || 0,
        shippingCharge: inv.shippingCharge || 0,
      }];
    }
    if (inv.deliveryOrder && !(inv.deliveryOrders || []).length) set.deliveryOrders = [inv.deliveryOrder];
    await col.updateOne({ _id: inv._id }, { ...(Object.keys(set).length ? { $set: set } : {}), $unset: { salesOrder: '', deliveryOrder: '' } });
  }
  // index lama
  const indexes = await col.indexes();
  for (const name of ['salesOrder_1', 'deliveryOrder_1']) {
    if (indexes.some((i) => i.name === name)) await col.dropIndex(name);
  }
  return old.length;
};

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const n = await migrateInvoiceDeliveries();
  console.log(n ? `[+] ${n} invoice dimigrasi ke daftar surat jalan` : '[=] Tidak ada invoice lama');
  await require('../models/SalesInvoice').syncIndexes();
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

module.exports = { migrateInvoiceDeliveries };
