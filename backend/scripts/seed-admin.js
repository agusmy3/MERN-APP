/**
 * Buat Super Admin PERTAMA untuk database kosong — hanya jika belum ada user sama sekali
 * (registrasi publik dimatikan, jadi tanpa ini tidak ada yang bisa login).
 *
 *   cd backend && npm run seed:admin -- --email=admin@contoh.com --password=RahasiaKuat123 [--name="Admin"]
 *   atau isi ADMIN_EMAIL, ADMIN_PASSWORD (& ADMIN_NAME) di backend/.env lalu: npm run seed:admin
 *
 * Aman dijalankan berulang kali: jika sudah ada user, tidak melakukan apa pun.
 * Password tidak pernah ditulis ke log. Ganti password setelah login pertama bila memakai .env.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const mongoose = require('mongoose');
const { runInTransaction } = require('../helpers/transaction');
const audit = require('../helpers/auditLogger');
const User = require('../models/User');
const Role = require('../models/Role');

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

async function main() {
  const email = String(arg('email') || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(arg('password') || process.env.ADMIN_PASSWORD || '');
  const name = String(arg('name') || process.env.ADMIN_NAME || 'Administrator').trim();

  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB\n');

  const userCount = await User.countDocuments();
  if (userCount > 0) {
    console.log(`[=] Sudah ada ${userCount} user; Super Admin pertama tidak dibuat. Kelola user lewat menu User.`);
    return;
  }

  if (!EMAIL_RX.test(email)) {
    throw new Error('Email admin tidak valid. Pakai --email=<email> atau ADMIN_EMAIL di .env');
  }
  if (password.length < MIN_PASSWORD) {
    throw new Error(`Password admin minimal ${MIN_PASSWORD} karakter. Pakai --password=<password> atau ADMIN_PASSWORD di .env`);
  }

  const user = await runInTransaction(async () => {
    let role = await Role.findOne({ isSystem: true });
    if (!role) {
      role = await Role.create({ name: 'Super Admin', deskripsi: 'Akses penuh ke semua menu dan operasi', isSystem: true, permissions: [] });
    }
    const created = await User.create({ name, email, password, role: role._id, isActive: true });
    await audit.logCreate({ user: { _id: created._id, name: `${name} (seed:admin)` }, headers: {}, ip: null }, 'user', [created]);
    return created;
  });
  console.log(`[+] Super Admin dibuat: ${user.email}`);
  console.log('\nSelesai. Login dengan email & password tersebut.');
}

main()
  .catch((err) => {
    console.error(`[!] ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
