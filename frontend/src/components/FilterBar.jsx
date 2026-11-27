import { Children, isValidElement, useState } from 'react';

/** Jumlah filter yang terisi: input / select (bukan pencarian) dengan value tidak kosong, termasuk yang bersarang */
const countActive = (nodes) => Children.toArray(nodes).reduce((n, el) => {
  if (!isValidElement(el)) return n;
  const own = (el.type === 'select' || el.type === 'input') && el.props.type !== 'search'
    && el.props.value !== undefined && el.props.value !== '' && el.props.value !== false ? 1 : 0;
  return n + own + countActive(el.props.children);
}, 0);

/**
 * Baris filter halaman daftar. Anak pertama (biasanya kotak cari) selalu tampil; sisanya:
 * - layar >= 640px (sm): sejajar seperti biasa (flex wrap)
 * - mobile: disembunyikan di balik tombol "Filter" (jumlah filter aktif), dibuka sebagai grid 2 kolom
 *   (rentang tanggal & tombol lebar memakai 2 kolom, lihat .filter-grid di index.css)
 */
export default function FilterBar({ children, className = 'mb-4' }) {
  const [open, setOpen] = useState(false);
  const items = Children.toArray(children).filter(Boolean);
  const [first, ...rest] = items;
  const active = countActive(rest);
  return (
    <div className={`${className} flex flex-wrap items-center gap-3`}>
      {first}
      {rest.length > 0 && (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
            className="sm:hidden shrink-0 px-3 py-2 rounded border border-line text-sm hover:bg-subtle cursor-pointer">
            <i className="fa fa-sliders mr-1.5" aria-hidden="true"></i>Filter
            {active > 0 && <span className="ml-1.5 px-1.5 rounded-full bg-primary text-primary-fg text-xs tabular-nums">{active}</span>}
            <i className={`fa fa-chevron-${open ? 'up' : 'down'} ml-1.5 text-xs`} aria-hidden="true"></i>
          </button>
          <div className={`filter-grid ${open ? 'grid' : 'hidden'} w-full grid-cols-2 gap-2 sm:contents`}>
            {rest}
          </div>
        </>
      )}
    </div>
  );
}
