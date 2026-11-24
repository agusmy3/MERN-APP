/**
 * Entry server: baca .env, koneksi MongoDB (wajib replica set, lihat config/db.js), lalu listen.
 * Route & middleware ada di app.js (dipakai juga oleh test).
 */
const dotenv = require('dotenv');

dotenv.config();
const connectDB = require('./config/db');
const app = require('./app');

connectDB();

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
