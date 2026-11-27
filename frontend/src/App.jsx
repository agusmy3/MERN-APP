import { Routes, Route } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import PublicLayout from './layouts/PublicLayout';
import ProtectedLayout from './layouts/ProtectedLayout';
import RequirePermission from './components/RequirePermission';
import { lazyWithReload } from './utils/lazyPage';

// Halaman dimuat per rute (chunk terpisah, diunduh saat pertama dibuka); Login & Dashboard ikut bundle utama.
const Kategori = lazyWithReload(() => import('./pages/Kategori'));
const Produk = lazyWithReload(() => import('./pages/Produk'));
const ProdukDetail = lazyWithReload(() => import('./pages/ProdukDetail'));
const Menu = lazyWithReload(() => import('./pages/Menu'));
const Vendor = lazyWithReload(() => import('./pages/Vendor'));
const Customer = lazyWithReload(() => import('./pages/Customer'));
const SalesInvoice = lazyWithReload(() => import('./pages/SalesInvoice'));
const SalesInvoiceDetail = lazyWithReload(() => import('./pages/SalesInvoiceDetail'));
const SalesReturn = lazyWithReload(() => import('./pages/SalesReturn'));
const SalesOrder = lazyWithReload(() => import('./pages/SalesOrder'));
const Quotation = lazyWithReload(() => import('./pages/Quotation'));
const QuotationDetail = lazyWithReload(() => import('./pages/QuotationDetail'));
const SalesOrderDetail = lazyWithReload(() => import('./pages/SalesOrderDetail'));
const DeliveryOrder = lazyWithReload(() => import('./pages/DeliveryOrder'));
const DeliveryOrderDetail = lazyWithReload(() => import('./pages/DeliveryOrderDetail'));
const SalesReturnDetail = lazyWithReload(() => import('./pages/SalesReturnDetail'));
const SalesPayment = lazyWithReload(() => import('./pages/SalesPayment'));
const PriceList = lazyWithReload(() => import('./pages/PriceList'));
const PriceListDetail = lazyWithReload(() => import('./pages/PriceListDetail'));
const SalesReport = lazyWithReload(() => import('./pages/SalesReport'));
const Outlet = lazyWithReload(() => import('./pages/Outlet'));
const Pos = lazyWithReload(() => import('./pages/Pos'));
const PosShift = lazyWithReload(() => import('./pages/PosShift'));
const Uom = lazyWithReload(() => import('./pages/Uom'));
const Variant = lazyWithReload(() => import('./pages/Variant'));
const Users = lazyWithReload(() => import('./pages/Users'));
const Roles = lazyWithReload(() => import('./pages/Roles'));
const Appearance = lazyWithReload(() => import('./pages/Appearance'));
const AuditLog = lazyWithReload(() => import('./pages/AuditLog'));
const Gudang = lazyWithReload(() => import('./pages/Gudang'));
const StockAdjustment = lazyWithReload(() => import('./pages/StockAdjustment'));
const StockAdjustmentDetail = lazyWithReload(() => import('./pages/StockAdjustmentDetail'));
const StockTransfer = lazyWithReload(() => import('./pages/StockTransfer'));
const StockTransferDetail = lazyWithReload(() => import('./pages/StockTransferDetail'));
const StockMovement = lazyWithReload(() => import('./pages/StockMovement'));
const PurchaseOrder = lazyWithReload(() => import('./pages/PurchaseOrder'));
const PurchaseOrderDetail = lazyWithReload(() => import('./pages/PurchaseOrderDetail'));
const GoodsReceipt = lazyWithReload(() => import('./pages/GoodsReceipt'));
const GoodsReceiptDetail = lazyWithReload(() => import('./pages/GoodsReceiptDetail'));
const PurchaseInvoice = lazyWithReload(() => import('./pages/PurchaseInvoice'));
const PurchaseInvoiceDetail = lazyWithReload(() => import('./pages/PurchaseInvoiceDetail'));
const VendorPayment = lazyWithReload(() => import('./pages/VendorPayment'));
const PaymentBatchList = lazyWithReload(() => import('./pages/PaymentBatchList'));
const PaymentBatchDetail = lazyWithReload(() => import('./pages/PaymentBatchDetail'));
const DepositList = lazyWithReload(() => import('./pages/DepositList'));
const DepositDetail = lazyWithReload(() => import('./pages/DepositDetail'));
const PurchaseReturn = lazyWithReload(() => import('./pages/PurchaseReturn'));
const PurchaseReturnDetail = lazyWithReload(() => import('./pages/PurchaseReturnDetail'));
const Settings = lazyWithReload(() => import('./pages/Settings'));
const StockValuation = lazyWithReload(() => import('./pages/StockValuation'));
const Reorder = lazyWithReload(() => import('./pages/Reorder'));
const CostRevaluation = lazyWithReload(() => import('./pages/CostRevaluation'));
const CostRevaluationDetail = lazyWithReload(() => import('./pages/CostRevaluationDetail'));
const NotFound = lazyWithReload(() => import('./pages/NotFound'));
const MapPage = lazyWithReload(() => import('./pages/MapPage'));

// Halaman yang butuh izin 'view' untuk resource-nya (key = backend/config/permissions.js)
const guard = (resource, element) => <RequirePermission resource={resource}>{element}</RequirePermission>;

function App() {
  return (
    <Routes>
      {/* Hanya untuk user yang belum login. Registrasi publik dimatikan (user dibuat admin). */}
      <Route element={<PublicLayout />}>
        <Route path="/login" element={<Login />} />
      </Route>

      {/* Wajib login, dibungkus MainLayout (Navbar + Sidebar).
          Halaman baru: daftarkan di sini (pakai guard jika butuh izin), lalu tambahkan
          datanya di menu Menu dengan `component` = path & `resource` yang sama. */}
      <Route element={<ProtectedLayout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/map" element={guard('map', <MapPage />)} />
        <Route path="/kategori" element={guard('kategori', <Kategori />)} />
        <Route path="/produk" element={guard('produk', <Produk />)} />
        <Route path="/produk/:id" element={guard('produk', <ProdukDetail />)} />
        <Route path="/vendor" element={guard('vendor', <Vendor />)} />
        <Route path="/customer" element={guard('customer', <Customer />)} />
        <Route path="/uom" element={guard('uom', <Uom />)} />
        <Route path="/variant" element={guard('variant', <Variant />)} />
        <Route path="/gudang" element={guard('gudang', <Gudang />)} />
        <Route path="/stock-adjustment" element={guard('stockAdjustment', <StockAdjustment />)} />
        {/* :id = 'new' (?type=ADJUSTMENT|OPNAME) atau id dokumen */}
        <Route path="/stock-adjustment/:id" element={guard('stockAdjustment', <StockAdjustmentDetail />)} />
        <Route path="/stock-transfer" element={guard('stockTransfer', <StockTransfer />)} />
        {/* :id = 'new' atau id dokumen */}
        <Route path="/stock-transfer/:id" element={guard('stockTransfer', <StockTransferDetail />)} />
        <Route path="/stock-movement" element={guard('stockMovement', <StockMovement />)} />
        {/* nilai persediaan = data biaya -> izin yang sama dengan harga beli */}
        <Route path="/reorder" element={guard('reorder', <Reorder />)} />
        <Route path="/stock-valuation" element={guard('vendorPrice', <StockValuation />)} />
        <Route path="/cost-revaluation" element={guard('costRevaluation', <CostRevaluation />)} />
        {/* :id = 'new' (?missing=1 = muat SKU tanpa HPP) atau id dokumen */}
        <Route path="/cost-revaluation/:id" element={guard('costRevaluation', <CostRevaluationDetail />)} />
        <Route path="/purchase-order" element={guard('purchaseOrder', <PurchaseOrder />)} />
        {/* :id = 'new' atau id dokumen */}
        <Route path="/purchase-order/:id" element={guard('purchaseOrder', <PurchaseOrderDetail />)} />
        <Route path="/goods-receipt" element={guard('goodsReceipt', <GoodsReceipt />)} />
        {/* :id = 'new' (?po=<poId>) atau id dokumen */}
        <Route path="/goods-receipt/:id" element={guard('goodsReceipt', <GoodsReceiptDetail />)} />
        <Route path="/purchase-invoice" element={guard('purchaseInvoice', <PurchaseInvoice />)} />
        {/* :id = 'new' (?vendor=) atau id tagihan */}
        <Route path="/purchase-invoice/:id" element={guard('purchaseInvoice', <PurchaseInvoiceDetail />)} />
        <Route path="/vendor-payment" element={guard('vendorPayment', <VendorPayment />)} />
        {/* pembayaran gabungan: beberapa tagihan vendor / invoice customer sekaligus; :id = 'new' atau id */}
        <Route path="/vendor-payment-batch" element={guard('vendorPayment', <PaymentBatchList kind="vendor" />)} />
        <Route path="/vendor-payment-batch/:id" element={guard('vendorPayment', <PaymentBatchDetail kind="vendor" />)} />
        <Route path="/customer-receipt" element={guard('salesPayment', <PaymentBatchList kind="customer" />)} />
        <Route path="/customer-receipt/:id" element={guard('salesPayment', <PaymentBatchDetail kind="customer" />)} />
        <Route path="/customer-deposit" element={guard('salesPayment', <DepositList kind="customer" />)} />
        <Route path="/customer-deposit/:id" element={guard('salesPayment', <DepositDetail kind="customer" />)} />
        <Route path="/vendor-deposit" element={guard('vendorPayment', <DepositList kind="vendor" />)} />
        <Route path="/vendor-deposit/:id" element={guard('vendorPayment', <DepositDetail kind="vendor" />)} />
        <Route path="/purchase-return" element={guard('purchaseReturn', <PurchaseReturn />)} />
        {/* :id = 'new' (?gr=) atau id dokumen */}
        <Route path="/purchase-return/:id" element={guard('purchaseReturn', <PurchaseReturnDetail />)} />
        <Route path="/quotation" element={guard('quotation', <Quotation />)} />
        {/* :id = 'new' atau id dokumen */}
        <Route path="/quotation/:id" element={guard('quotation', <QuotationDetail />)} />
        <Route path="/sales-order" element={guard('salesOrder', <SalesOrder />)} />
        {/* :id = 'new' atau id dokumen */}
        <Route path="/sales-order/:id" element={guard('salesOrder', <SalesOrderDetail />)} />
        <Route path="/delivery-order" element={guard('deliveryOrder', <DeliveryOrder />)} />
        {/* :id = 'new' (?so=<soId>) atau id dokumen */}
        <Route path="/delivery-order/:id" element={guard('deliveryOrder', <DeliveryOrderDetail />)} />
        <Route path="/sales-invoice" element={guard('salesInvoice', <SalesInvoice />)} />
        {/* :id = 'new' atau id dokumen */}
        <Route path="/sales-invoice/:id" element={guard('salesInvoice', <SalesInvoiceDetail />)} />
        <Route path="/sales-return" element={guard('salesReturn', <SalesReturn />)} />
        {/* :id = 'new' (?invoice=) atau id dokumen */}
        <Route path="/sales-return/:id" element={guard('salesReturn', <SalesReturnDetail />)} />
        <Route path="/sales-payment" element={guard('salesPayment', <SalesPayment />)} />
        <Route path="/price-list" element={guard('priceList', <PriceList />)} />
        <Route path="/price-list/:id" element={guard('priceList', <PriceListDetail />)} />
        <Route path="/sales-report" element={guard('salesReport', <SalesReport />)} />
        <Route path="/outlet" element={guard('outlet', <Outlet />)} />
        <Route path="/pos" element={guard('pos', <Pos />)} />
        <Route path="/pos-shift" element={guard('posShift', <PosShift />)} />
        <Route path="/settings" element={guard('setting', <Settings />)} />
        <Route path="/menu" element={guard('menu', <Menu />)} />
        <Route path="/users" element={guard('user', <Users />)} />
        <Route path="/roles" element={guard('role', <Roles />)} />
        <Route path="/audit-log" element={guard('auditLog', <AuditLog />)} />
        <Route path="/appearance" element={<Appearance />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export default App
