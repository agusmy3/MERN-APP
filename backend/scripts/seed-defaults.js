/**
 * Data bawaan yang dibutuhkan aplikasi — aman dijalankan berulang kali (idempotent).
 *   cd backend && npm run seed:defaults
 *
 * - Customer "Umum / Walk-in" (isWalkIn, kode WALKIN): default penjualan tanpa data pembeli.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const mongoose = require('mongoose');
const User = require('../models/User');
const Customer = require('../models/Customer');
const { ensureWalkInCustomer } = require('../controllers/customerController');

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  await Customer.createCollection().catch(() => {});
  await Customer.createIndexes().catch(() => {});
  const admin = await User.findOne().sort({ createdDate: 1 }).select('_id').lean();
  const { customer, created } = await ensureWalkInCustomer(admin?._id ?? null);
  console.log(created ? `[+] Customer walk-in dibuat (${customer.code})` : `[=] Customer walk-in sudah ada (${customer.code})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
