import { useAuth } from '../context/AuthContext';

/**
 * Izin user untuk satu resource (key di backend/config/permissions.js, mis. 'produk').
 * Hanya untuk tampilan (sembunyikan tombol/menu); penegakan sebenarnya ada di backend.
 *
 * loaded = false selama izin belum dimuat dari server.
 */
export default function usePermission(resource) {
  const { user } = useAuth();
  const permissions = user?.permissions;
  const actions = permissions?.[resource] || [];

  return {
    loaded: permissions !== undefined,
    canView: actions.includes('view'),
    canCreate: actions.includes('create'),
    canUpdate: actions.includes('update'),
    canDelete: actions.includes('delete'),
    // posting & pembatalan dokumen stok (hanya resource yang punya action 'post')
    canPost: actions.includes('post'),
  };
}
