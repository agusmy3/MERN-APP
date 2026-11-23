import { useAuth } from '../context/AuthContext';
import usePageMeta from '../hooks/usePageMeta';

export default function Dashboard() {
  const { user } = useAuth();
  usePageMeta('Dashboard'); // judul tab mengikuti nama menu untuk "/"

  return (
    <div>
      <div className="p-6">
        <h1 className="text-2xl font-bold text-fg mb-4">
          Selamat datang, {user?.name || "User"}!
        </h1>
        <p className="text-muted">
          Ini adalah halaman dashboard. Gunakan menu di sidebar untuk mengelola data master.
        </p>
      </div>
    </div>
  );
}
