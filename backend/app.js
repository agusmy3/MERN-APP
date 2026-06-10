const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const connectDB = require('./config/db');

dotenv.config();
connectDB();

const app = express();
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  res.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, private"
  );

  next();
});

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/kategori', require('./routes/kategoriRoutes'));
app.use('/api/produk', require('./routes/produkRoutes'));
app.use('/api/menu', require('./routes/menuRoutes'));
app.use('/api/vendor', require('./routes/vendorRoutes'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
