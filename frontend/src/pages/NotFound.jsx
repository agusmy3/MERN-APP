import { Link, useLocation } from 'react-router-dom';
import useDocumentTitle from '../hooks/useDocumentTitle';

export default function NotFound() {
  const location = useLocation();
  useDocumentTitle('Page not found');

  return (
    <div className="h-full flex flex-col items-center justify-center p-4 text-center">
      <h1 className="text-6xl font-bold text-muted/40 mb-2">404</h1>
      <p className="text-xl font-semibold text-fg mb-1">Page not found</p>
      <p className="text-muted mb-6">
        Halaman <code className="bg-subtle px-1 rounded">{location.pathname}</code> tidak ditemukan.
      </p>
      <Link to="/" className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded">
        <i className="fa fa-house"></i> Back to Dashboard
      </Link>
    </div>
  );
}
