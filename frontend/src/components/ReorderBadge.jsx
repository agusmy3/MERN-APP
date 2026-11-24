import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getReorderSummary } from '../services/stockService';
import { useAuth } from '../context/AuthContext';
import usePermission from '../hooks/usePermission';

const REFRESH_MS = 5 * 60 * 1000;

/**
 * Ikon lonceng di Navbar: jumlah SKU yang perlu dipesan (habis + kritis), link ke halaman Reorder.
 * Hanya untuk user dengan izin reorder:view. Dimuat ulang saat pindah halaman & tiap 5 menit.
 */
export default function ReorderBadge({ className }) {
  const { user } = useAuth();
  const { canView } = usePermission('reorder');
  const { pathname } = useLocation();
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    if (!canView || !user?.token) return undefined;
    let cancelled = false;
    const load = () => getReorderSummary(user.token)
      .then((s) => { if (!cancelled) setSummary(s); })
      .catch(() => {});
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [canView, user?.token, pathname]);

  if (!canView) return null;
  const count = summary?.needAction || 0;
  const label = count
    ? `${count} SKU perlu dipesan (habis ${summary.OUT}, kritis ${summary.CRITICAL})`
    : 'Reorder: tidak ada SKU yang perlu dipesan';

  return (
    <Link to="/reorder" className={`relative ${className}`} aria-label={label} title={label}>
      <i className="fa fa-bell"></i>
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-danger text-danger-fg text-[10px] font-bold leading-4 text-center tabular-nums">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
