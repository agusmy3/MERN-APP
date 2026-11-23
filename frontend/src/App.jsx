import { Routes, Route } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Kategori from './pages/Kategori';
import Produk from './pages/Produk';
import ProdukDetail from './pages/ProdukDetail';
import Menu from './pages/Menu';
import Vendor from './pages/Vendor';
import Uom from './pages/Uom';
import Variant from './pages/Variant';
import Users from './pages/Users';
import Roles from './pages/Roles';
import Appearance from './pages/Appearance';
import AuditLog from './pages/AuditLog';
import Gudang from './pages/Gudang';
import StockAdjustment from './pages/StockAdjustment';
import StockAdjustmentDetail from './pages/StockAdjustmentDetail';
import StockMovement from './pages/StockMovement';
import PurchaseOrder from './pages/PurchaseOrder';
import PurchaseOrderDetail from './pages/PurchaseOrderDetail';
import GoodsReceipt from './pages/GoodsReceipt';
import GoodsReceiptDetail from './pages/GoodsReceiptDetail';
import Settings from './pages/Settings';
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
        <Route path="/uom" element={guard('uom', <Uom />)} />
        <Route path="/variant" element={guard('variant', <Variant />)} />
        <Route path="/gudang" element={guard('gudang', <Gudang />)} />
        <Route path="/stock-adjustment" element={guard('stockAdjustment', <StockAdjustment />)} />
        {/* :id = 'new' (?type=ADJUSTMENT|OPNAME) atau id dokumen */}
        <Route path="/stock-adjustment/:id" element={guard('stockAdjustment', <StockAdjustmentDetail />)} />
        <Route path="/stock-movement" element={guard('stockMovement', <StockMovement />)} />
        <Route path="/purchase-order" element={guard('purchaseOrder', <PurchaseOrder />)} />
        {/* :id = 'new' atau id dokumen */}
        <Route path="/purchase-order/:id" element={guard('purchaseOrder', <PurchaseOrderDetail />)} />
        <Route path="/goods-receipt" element={guard('goodsReceipt', <GoodsReceipt />)} />
        {/* :id = 'new' (?po=<poId>) atau id dokumen */}
        <Route path="/goods-receipt/:id" element={guard('goodsReceipt', <GoodsReceiptDetail />)} />
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
