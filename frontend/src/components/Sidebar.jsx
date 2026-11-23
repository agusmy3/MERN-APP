import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import useMenus from "../hooks/useMenus";
import SidebarMenu from "./SidebarMenu";

/**
 * Layar besar (>= lg / 1024px): sidebar di samping konten, bisa disembunyikan
 *   lewat tombol ☰ (lebar menyusut ke 0, konten melebar).
 * Layar kecil: drawer dari kiri lewat tombol ☰, tertutup otomatis saat pindah
 *   halaman, klik backdrop, atau tekan Esc.
 *
 * `open` dan `isDesktop` dikelola MainLayout; `onClose` hanya untuk drawer layar kecil.
 */
export default function Sidebar({ open, isDesktop, onClose }) {
  // data menu dari MenuProvider (sama dengan yang dipakai judul halaman)
  const { menus } = useMenus();
  const { pathname } = useLocation();

  // tutup drawer setelah memilih menu (pindah halaman)
  useEffect(() => {
    onClose();
  }, [pathname, onClose]);

  // Esc hanya untuk drawer layar kecil, bukan untuk menyembunyikan sidebar di layar besar
  useEffect(() => {
    if (!open || isDesktop) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, isDesktop, onClose]);

  const desktopClass = open
    ? 'lg:w-64 lg:border-r lg:border-side-line'
    : 'lg:w-0 lg:border-r-0';

  return (
    <>
      {/* backdrop, hanya di layar kecil saat drawer terbuka */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={`fixed inset-0 z-30 bg-black/40 transition-opacity duration-300 lg:hidden ${
          open && !isDesktop ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />

      <aside
        id="app-sidebar"
        aria-label="Main menu"
        // sidebar yang tersembunyi tidak boleh bisa di-tab / dibaca screen reader
        inert={!open}
        className={`
          fixed inset-y-0 left-0 z-40 w-64 max-w-[80vw] shrink-0
          bg-side text-side-fg overflow-hidden
          transition-transform duration-300 ease-out
          ${open ? 'translate-x-0' : '-translate-x-full'}
          lg:static lg:z-auto lg:max-w-none lg:translate-x-0
          lg:transition-[width] ${desktopClass}
        `}
      >
        {/* lebar isi tetap 256px supaya teks menu tidak ikut terlipat saat animasi menyusut */}
        <div className="w-64 max-w-[80vw] lg:max-w-none h-full overflow-y-auto p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="px-3 text-xs font-semibold uppercase tracking-wider text-side-muted">Menu</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close menu"
              className="lg:hidden w-8 h-8 rounded-md hover:bg-side-hover cursor-pointer"
            >
              <i className="fa fa-xmark"></i>
            </button>
          </div>
          <nav className="space-y-2">
            <SidebarMenu items={menus} />
          </nav>
        </div>
      </aside>
    </>
  );
}
