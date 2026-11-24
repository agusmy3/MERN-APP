import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ReorderBadge from './ReorderBadge';

// "Agus Maulana Yusup" -> "AM"
const getInitials = (name = '') =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';

export default function Navbar({ sidebarOpen, onToggleSidebar }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  if (!user) return null;

  const iconButton = 'w-9 h-9 shrink-0 grid place-items-center rounded-md hover:bg-nav-hover cursor-pointer';

  return (
    <nav className="sticky top-0 z-20 bg-nav text-nav-fg border-b border-nav-line px-3 lg:px-5 py-2 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        {/* tombol tampilkan/sembunyikan sidebar (layar kecil: drawer, layar besar: hide/show) */}
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? 'Hide menu' : 'Show menu'}
          title={sidebarOpen ? 'Hide menu' : 'Show menu'}
          aria-controls="app-sidebar"
          aria-expanded={sidebarOpen}
          className={iconButton}
        >
          <i className="fa fa-bars text-lg"></i>
        </button>
        <Link to="/" className="font-bold tracking-tight truncate">MERN App</Link>
      </div>

      <div className="flex items-center gap-2">
        <ReorderBadge className={iconButton} />
        <Link to="/appearance" className={iconButton} aria-label="Appearance" title="Appearance">
          <i className="fa fa-palette"></i>
        </Link>
        <div className="flex items-center gap-2 min-w-0" title={`${user.name} (${user.email})`}>
          <span
            aria-hidden="true"
            className="w-8 h-8 shrink-0 rounded-full grid place-items-center text-xs font-bold bg-primary-soft text-primary-soft-fg"
          >
            {getInitials(user.name)}
          </span>
          <span className="hidden md:block text-sm font-medium max-w-40 truncate">{user.name}</span>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="ml-1 px-3 py-1.5 rounded-md border border-nav-fg/25 hover:bg-nav-hover text-sm font-medium cursor-pointer"
        >
          <i className="fa fa-right-from-bracket md:mr-1.5"></i>
          <span className="hidden md:inline">Logout</span>
          <span className="sr-only md:hidden">Logout</span>
        </button>
      </div>
    </nav>
  );
}
