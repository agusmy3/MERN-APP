import { Link } from 'react-router-dom';
import useDocumentTitle from '../hooks/useDocumentTitle';

/** Ditampilkan saat user membuka halaman yang tidak diizinkan untuk role-nya. */
export default function Forbidden() {
  useDocumentTitle('Access denied');

  return (
    <div className="h-full flex flex-col items-center justify-center p-4 text-center">
      <span className="w-16 h-16 mb-4 rounded-full grid place-items-center bg-danger-soft text-danger text-2xl" aria-hidden="true">
        <i className="fa fa-lock"></i>
      </span>
      <h1 className="text-xl font-semibold text-fg mb-1">Access denied</h1>
      <p className="text-muted mb-6 max-w-md">
        Role Anda tidak memiliki akses ke halaman ini. Hubungi administrator jika Anda memerlukan akses.
      </p>
      <Link to="/" className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded">
        <i className="fa fa-house"></i> Back to Dashboard
      </Link>
    </div>
  );
}
