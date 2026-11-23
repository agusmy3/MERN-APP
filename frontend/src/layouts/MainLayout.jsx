import { useCallback, useState } from 'react';
import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';
import useMediaQuery from '../hooks/useMediaQuery';

const SIDEBAR_HIDDEN_KEY = 'sidebarHidden';

const readSidebarHidden = () => {
  try {
    return localStorage.getItem(SIDEBAR_HIDDEN_KEY) === 'true';
  } catch {
    return false;
  }
};

export default function MainLayout({ children }) {
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  // Layar besar: sidebar tampil di samping konten, bisa disembunyikan (pilihan diingat browser).
  const [desktopHidden, setDesktopHidden] = useState(readSidebarHidden);
  // Layar kecil: sidebar berupa drawer, selalu tertutup di awal.
  const [mobileOpen, setMobileOpen] = useState(false);

  const sidebarOpen = isDesktop ? !desktopHidden : mobileOpen;

  const toggleSidebar = () => {
    if (isDesktop) {
      const next = !desktopHidden;
      setDesktopHidden(next);
      try {
        localStorage.setItem(SIDEBAR_HIDDEN_KEY, String(next));
      } catch {
        // localStorage tidak tersedia (mis. mode private), cukup berlaku di sesi ini
      }
    } else {
      setMobileOpen((prev) => !prev);
    }
  };

  // dipakai drawer layar kecil (pindah halaman, backdrop, Esc); tidak memengaruhi layar besar
  const closeMobileSidebar = useCallback(() => setMobileOpen(false), []);

  return (
    <div className='h-screen flex flex-col overflow-hidden'>
      <Navbar sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />
      <div className='flex flex-1 min-h-0 overflow-hidden'>
        <Sidebar open={sidebarOpen} isDesktop={isDesktop} onClose={closeMobileSidebar} />
        <main className='flex-1 min-w-0 min-h-0 overflow-hidden'>
          {children}
        </main>
      </div>
    </div>
  );
}
