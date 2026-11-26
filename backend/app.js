/**
 * Aplikasi Express (route & middleware) TANPA koneksi database dan TANPA listen,
 * supaya bisa dipakai test (supertest). Server sungguhan dijalankan oleh server.js.
 */
const express = require('express');
const cors = require('cors');

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
app.use('/api/stock-transfer', require('./routes/stockRoutes').transfer);
app.use('/api/stock-movement', require('./routes/stockRoutes').movement);
app.use('/api/stock-valuation', require('./routes/stockRoutes').valuation);
app.use('/api/cost-revaluation', require('./routes/stockRoutes').revaluation);
app.use('/api/reorder', require('./routes/stockRoutes').reorder);
app.use('/api/purchase-order', require('./routes/purchaseRoutes').purchaseOrder);
app.use('/api/goods-receipt', require('./routes/purchaseRoutes').goodsReceipt);
app.use('/api/purchase-invoice', require('./routes/purchaseRoutes').purchaseInvoice);
app.use('/api/vendor-payment', require('./routes/purchaseRoutes').vendorPayment);
app.use('/api/purchase-return', require('./routes/purchaseRoutes').purchaseReturn);
app.use('/api/customer', require('./routes/salesRoutes').customer);
app.use('/api/sales-invoice', require('./routes/salesRoutes').salesInvoice);
app.use('/api/quotation', require('./routes/salesRoutes').quotation);
app.use('/api/sales-order', require('./routes/salesRoutes').salesOrder);
app.use('/api/delivery-order', require('./routes/salesRoutes').deliveryOrder);
app.use('/api/sales-return', require('./routes/salesRoutes').salesReturn);
app.use('/api/sales-payment', require('./routes/salesRoutes').salesPayment);
app.use('/api/price-list', require('./routes/salesRoutes').priceList);
app.use('/api/sales-report', require('./routes/salesRoutes').salesReport);
app.use('/api/outlet', require('./routes/posRoutes').outlet);
app.use('/api/pos', require('./routes/posRoutes').pos);
app.use('/api/pos-shift', require('./routes/posRoutes').posShift);
app.use('/api/setting', require('./routes/settingRoutes'));
app.use('/api/dashboard', require('./routes/dashboardRoutes'));

module.exports = app;
