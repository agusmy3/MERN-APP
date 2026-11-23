import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { setUnauthorizedHandler, setForbiddenHandler } from '../utils/axiosSetup';
import { getMe } from '../services/authService';

const AuthContext = createContext();

// Cek field `exp` di payload JWT (detik) tanpa perlu verifikasi signature
const isTokenExpired = (token) => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return !payload.exp || payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
};

const loadStoredUser = () => {
  try {
    const stored = JSON.parse(localStorage.getItem('user'));
    if (stored?.token && !isTokenExpired(stored.token)) return stored;
  } catch {
    // data localStorage rusak, anggap belum login
  }
  localStorage.removeItem('user');
  return null;
};

const REFRESH_THROTTLE_MS = 2000;

/**
 * user = { _id, name, email, theme, role: { _id, name, isSystem }, permissions: { produk: ['view', ...] }, token }
 * `permissions` undefined = belum dimuat (mis. data login lama sebelum fitur role ada).
 */
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(loadStoredUser);
  const [sessionExpired, setSessionExpired] = useState(false);

  const tokenRef = useRef(user?.token);
  tokenRef.current = user?.token;
  const lastRefresh = useRef(0);

  const login = (userData) => {
    localStorage.setItem('user', JSON.stringify(userData));
    setSessionExpired(false);
    setUser(userData);
  };

  // perbarui sebagian data user (mis. { theme }) tanpa login ulang
  const updateUser = useCallback((patch) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      localStorage.setItem('user', JSON.stringify(next));
      return next;
    });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('user');
    setUser(null);
  }, []);

  // Muat ulang profil, role & izin dari server (izin bisa diubah admin kapan saja)
  const refreshUser = useCallback(async () => {
    const token = tokenRef.current;
    if (!token || Date.now() - lastRefresh.current < REFRESH_THROTTLE_MS) return;
    lastRefresh.current = Date.now();
    try {
      updateUser(await getMe(token));
    } catch (err) {
      // 401 sudah ditangani interceptor (logout); selain itu cukup dicatat
      console.error(err);
    }
  }, [updateUser]);

  // saat aplikasi dibuka: pastikan izin yang dipakai adalah yang terbaru
  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  // Token ditolak server (kedaluwarsa / tidak valid / akun dinonaktifkan) -> logout otomatis.
  // Setelah user = null, ProtectedLayout akan mengarahkan ke /login.
  // 403 (tidak punya izin) -> muat ulang izin supaya menu & tombol menyesuaikan.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (!localStorage.getItem('user')) return; // sudah logout, abaikan 401 berikutnya
      setSessionExpired(true);
      logout();
    });
    setForbiddenHandler(() => refreshUser());
    return () => {
      setUnauthorizedHandler(null);
      setForbiddenHandler(null);
    };
  }, [logout, refreshUser]);

  return (
    <AuthContext.Provider value={{ user, login, logout, updateUser, refreshUser, sessionExpired }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
