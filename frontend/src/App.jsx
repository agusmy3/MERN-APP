import { Routes, Route } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Kategori from './pages/Kategori';
import Produk from './pages/Produk';
import ProdukDetail from './pages/ProdukDetail';
import Menu from './pages/Menu';
import Vendor from './pages/Vendor';
import Customer from './pages/Customer';
import SalesInvoice from './pages/SalesInvoice';
import SalesInvoiceDetail from './pages/SalesInvoiceDetail';
import SalesReturn from './pages/SalesReturn';
import SalesOrder from './pages/SalesOrder';
import Quotation from './pages/Quotation';
import QuotationDetail from './pages/QuotationDetail';
import SalesOrderDetail from './pages/SalesOrderDetail';
import DeliveryOrder from './pages/DeliveryOrder';
import DeliveryOrderDetail from './pages/DeliveryOrderDetail';
import SalesReturnDetail from './pages/SalesReturnDetail';
import SalesPayment from './pages/SalesPayment';
import PriceList from './pages/PriceList';
import PriceListDetail from './pages/PriceListDetail';
import SalesReport from './pages/SalesReport';
import Outlet from './pages/Outlet';
import Pos from './pages/Pos';
import PosShift from './pages/PosShift';
import Uom from './pages/Uom';
import Variant from './pages/Variant';
import Users from './pages/Users';
import Roles from './pages/Roles';
import Appearance from './pages/Appearance';
import AuditLog from './pages/AuditLog';
import Gudang from './pages/Gudang';
import StockAdjustment from './pages/StockAdjustment';
import StockAdjustmentDetail from './pages/StockAdjustmentDetail';
import StockTransfer from './pages/StockTransfer';
import StockTransferDetail from './pages/StockTransferDetail';
import StockMovement from './pages/StockMovement';
import PurchaseOrder from './pages/PurchaseOrder';
import PurchaseOrderDetail from './pages/PurchaseOrderDetail';
import GoodsReceipt from './pages/GoodsReceipt';
import GoodsReceiptDetail from './pages/GoodsReceiptDetail';
import PurchaseInvoice from './pages/PurchaseInvoice';
import PurchaseInvoiceDetail from './pages/PurchaseInvoiceDetail';
import VendorPayment from './pages/VendorPayment';
import PaymentBatchList from './pages/PaymentBatchList';
import PaymentBatchDetail from './pages/PaymentBatchDetail';
import PurchaseReturn from './pages/PurchaseReturn';
import PurchaseReturnDetail from './pages/PurchaseReturnDetail';
import Settings from './pages/Settings';
import StockValuation from './pages/StockValuation';
import Reorder from './pages/Reorder';
import CostRevaluation from './pages/CostRevaluation';
import CostRevaluationDetail from './pages/CostRevaluationDetail';
import NotFound from './pages/NotFound';
import PublicLayout from './layouts/PublicLayout';
import ProtectedLayout from './layouts/ProtectedLayout';
import RequirePermission from './components/RequirePermission';

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
