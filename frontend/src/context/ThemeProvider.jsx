import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { ThemeContext } from './ThemeContext';
import { updateTheme as saveThemeToServer } from '../services/authService';
import { DEFAULT_THEME, THEME_STORAGE_KEY, isValidTheme } from '../theme/themes';

const readStoredTheme = () => {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isValidTheme(stored)) return stored;
  } catch {
    // localStorage tidak tersedia
  }
  return DEFAULT_THEME;
};

/**
 * Tema aktif = pilihan user di server (user.theme) jika sudah login,
 * jika belum: tema terakhir di browser, jika belum ada: DEFAULT_THEME.
 * Disalin ke localStorage supaya index.html bisa menerapkannya sebelum React render.
 */
export default function ThemeProvider({ children }) {
  const { user, updateUser } = useAuth();
  const [theme, setThemeState] = useState(readStoredTheme);

  // terapkan ke <html data-theme="..."> dan simpan di browser
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // abaikan, tema tetap berlaku di sesi ini
    }
  }, [theme]);

  // ikuti pilihan yang tersimpan di akun (mis. setelah login di perangkat lain)
  const userTheme = user?.theme;
  useEffect(() => {
    if (isValidTheme(userTheme)) setThemeState(userTheme);
  }, [userTheme]);

  const setTheme = useCallback(async (id) => {
    if (!isValidTheme(id)) return;
    const previous = theme;
    setThemeState(id); // langsung terlihat, tanpa menunggu server
    if (!user) return;
    try {
      await saveThemeToServer(id, user.token);
      updateUser({ theme: id });
    } catch (err) {
      setThemeState(previous);
      throw err;
    }
  }, [theme, user, updateUser]);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
