import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import usePageMeta from '../hooks/usePageMeta';

/**
 * Header halaman: breadcrumb (dari hierarki Menu), judul + ikon, dan subjudul (Menu.deskripsi).
 * Semua diambil dari data Menu untuk route aktif; `fallbackTitle` dipakai jika tidak ada.
 *
 * Halaman turunan (mis. detail produk): beri `parentPath` + `title` (lihat usePageMeta).
 * `subtitle` menimpa subjudul dari Menu; `actions` = tombol di kanan judul.
 */
export default function PageHeader({ fallbackTitle, parentPath, title: childTitle, subtitle: subtitleOverride, actions }) {
  const { title, subtitle, icon, trail } = usePageMeta(fallbackTitle, { parentPath, title: childTitle });
  const parents = trail.slice(0, -1);
  const shownSubtitle = subtitleOverride ?? subtitle;

  return (
    <header className="mb-4 shrink-0 min-w-0">
      <nav aria-label="Breadcrumb" className="mb-1 text-xs text-muted">
        <ol className="flex items-center gap-1.5 min-w-0">
          <li className="shrink-0">
            <Link to="/" className="hover:text-primary" aria-label="Dashboard" title="Dashboard">
              <i className="fa fa-house"></i>
            </Link>
          </li>
          {parents.map((menu) => (
            <Fragment key={menu._id}>
              <li aria-hidden="true" className="shrink-0 text-muted/50">›</li>
              <li className="truncate">
                {menu.component
                  ? <Link to={menu.component} className="hover:text-primary">{menu.menu}</Link>
                  : menu.menu}
              </li>
            </Fragment>
          ))}
          <li aria-hidden="true" className="shrink-0 text-muted/50">›</li>
          <li aria-current="page" className="truncate font-medium text-fg">{title}</li>
        </ol>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-3 text-2xl/8 font-bold text-fg sm:text-3xl/9 sm:tracking-tight min-w-0">
            {/* ikon mengikuti warna & ukuran judul (em), supaya terlihat satu kesatuan */}
            {icon && <i className={`${icon} text-[0.8em] w-[1.25em] text-center shrink-0`} aria-hidden="true"></i>}
            <span className="truncate">{title}</span>
          </h1>

          {shownSubtitle && (
            <p className="mt-1 text-sm text-muted line-clamp-2">{shownSubtitle}</p>
          )}
        </div>
        {/* mobile: baris sendiri selebar layar & tombol turun ke baris berikutnya (dulu shrink-0 -> terpotong, tidak bisa
            digeser); >= 640px: di kanan judul, rata kanan, tetap boleh wrap bila tombolnya banyak */}
        {actions && <div className="flex flex-wrap items-center gap-2 min-w-0 w-full sm:w-auto sm:max-w-full sm:justify-end">{actions}</div>}
      </div>
    </header>
  );
}
