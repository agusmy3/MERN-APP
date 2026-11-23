import usePermission from '../hooks/usePermission';
import Forbidden from '../pages/Forbidden';

/**
 * Route guard per halaman: butuh izin 'view' untuk `resource`.
 * Membuka URL langsung tanpa izin -> halaman Access denied (bukan 404).
 */
export default function RequirePermission({ resource, children }) {
  const { loaded, canView } = usePermission(resource);

  if (!loaded) {
    return <div className="p-6 text-muted">Loading...</div>;
  }
  if (!canView) {
    return <Forbidden />;
  }
  return children;
}
