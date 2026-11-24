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
app.use('/api/uom', require('./routes/uomRoutes'));
app.use('/api/variant', require('./routes/variantRoutes'));
app.use('/api/vendor-price', require('./routes/vendorPriceRoutes'));
app.use('/api/role', require('./routes/roleRoutes'));
app.use('/api/user', require('./routes/userRoutes'));
app.use('/api/audit-log', require('./routes/auditLogRoutes'));
app.use('/api/gudang', require('./routes/gudangRoutes'));
app.use('/api/stock-adjustment', require('./routes/stockRoutes').adjustment);
app.use('/api/stock-movement', require('./routes/stockRoutes').movement);
app.use('/api/stock-valuation', require('./routes/stockRoutes').valuation);
app.use('/api/cost-revaluation', require('./routes/stockRoutes').revaluation);
app.use('/api/purchase-order', require('./routes/purchaseRoutes').purchaseOrder);
app.use('/api/goods-receipt', require('./routes/purchaseRoutes').goodsReceipt);
app.use('/api/setting', require('./routes/settingRoutes'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
