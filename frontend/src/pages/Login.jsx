import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { loginUser } from '../services/authService';
import useDocumentTitle from '../hooks/useDocumentTitle';
import useToast from '../hooks/useToast';

export default function Login() {
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const { login, sessionExpired } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  useDocumentTitle('Login');
  const location = useLocation();
  // halaman yang tadinya dibuka sebelum diarahkan ke login (diisi ProtectedLayout)
  const redirectTo = location.state?.from?.pathname || '/';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const userData = await loginUser(form);
      login(userData); // simpan di context & cache
      navigate(redirectTo, { replace: true });
    } catch (err) {
      // pesan dari backend (mis. "Invalid email or password"), atau pesan umum jika server tidak terjangkau
      toast.error(err.response?.data?.message || 'Login gagal. Periksa email & password, lalu coba lagi.');
    } finally {
      setLoading(false);
    }
  };

  return (
 <div className="min-h-screen flex items-center justify-center bg-page px-4">
      <div className="w-full max-w-md bg-surface border border-line p-6 rounded-lg shadow-sm">
        <h2 className="text-2xl font-bold mb-6 text-center text-fg">Login</h2>

        {sessionExpired && (
          <div className="mb-4 px-4 py-2 rounded bg-warning-soft text-warning-fg text-sm">
            Sesi Anda telah berakhir. Silakan login kembali.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block mb-1 text-sm font-medium text-muted">Email</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full bg-input text-fg border border-line rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label className="block mb-1 text-sm font-medium text-muted">Password</label>
            <input
              type="password"
              required
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="w-full bg-input text-fg border border-line rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary hover:bg-primary-hover text-primary-fg font-semibold py-2 px-4 rounded transition duration-300"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>

        <p className="text-center text-sm text-muted mt-4">
          Belum punya akun? Hubungi administrator.
        </p>
      </div>
    </div>
  );
}
