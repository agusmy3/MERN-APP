import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { getMenuTree } from '../services/menuService';
import { MenuContext } from './MenuContext';

/** Memuat pohon menu sekali per login; `reloadMenus` dipanggil setelah data Menu diubah. */
export default function MenuProvider({ children }) {
  const { user } = useAuth();
  const [menus, setMenus] = useState([]);
  const [loading, setLoading] = useState(true);

  const reloadMenus = useCallback(async () => {
    try {
      const res = await getMenuTree(user.token);
      setMenus(res.data.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [user.token]);

  // pohon menu dari server sudah disaring sesuai izin user, jadi muat ulang jika izin berubah
  const permissionsKey = JSON.stringify(user.permissions ?? null);
  useEffect(() => {
    reloadMenus();
  }, [reloadMenus, permissionsKey]);

  const value = useMemo(() => ({ menus, loading, reloadMenus }), [menus, loading, reloadMenus]);

  return <MenuContext.Provider value={value}>{children}</MenuContext.Provider>;
}
