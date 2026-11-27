import { Suspense } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import MainLayout from './MainLayout';
import MenuProvider from '../context/MenuProvider';

// Layout untuk semua halaman yang butuh login.
// Belum login -> ke /login, sambil mengingat halaman tujuan agar bisa kembali setelah login.
export default function ProtectedLayout() {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // MenuProvider: data menu dipakai bersama oleh Sidebar dan judul/breadcrumb halaman
  return (
    <MenuProvider>
      <MainLayout>
        {/* halaman dimuat lazy (App.jsx): navbar & sidebar tetap tampil selama chunk halaman diunduh */}
        <Suspense fallback={<div className="p-6 text-muted">Loading...</div>}>
          <Outlet />
        </Suspense>
      </MainLayout>
    </MenuProvider>
  );
}
