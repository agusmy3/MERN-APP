import { useAuth } from '../context/AuthContext';

export default function Dashboard() {
  const { user } = useAuth();

  return (
    <div>
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-700 mb-4">
          Selamat datang, {user?.name || "User"}!
        </h1>
        <p className="text-gray-600">
          Ini adalah halaman dashboard. Gunakan navbar untuk mengakses produk dan kategori.
        </p>
      </div>
    </div>
  );
}
