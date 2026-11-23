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
        <Outlet />
      </MainLayout>
    </MenuProvider>
  );
}
