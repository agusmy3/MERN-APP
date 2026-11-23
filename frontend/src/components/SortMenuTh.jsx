import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useDismiss from '../hooks/useDismiss';

const MENU_WIDTH = 240;

const SORT_DIRECTIONS = [
  { order: 'desc', text: 'Newest first', icon: 'fa-arrow-down-wide-short' },
  { order: 'asc', text: 'Oldest first', icon: 'fa-arrow-up-short-wide' },
];

/**
 * Header kolom dengan menu pilihan sort, untuk kolom yang mewakili beberapa field
 * (mis. "Last Modified" -> createdDate / updatedDate).
 *
 * options: [{ field, label, shortLabel? }]
 * Menu dirender lewat portal ke <body> supaya tidak terpotong container tabel yang ber-scroll.
 */
export default function SortMenuTh({ label, options, sortField, sortOrder, onSelect, className = '' }) {
  const [pos, setPos] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  const open = pos !== null;
  const close = useCallback(() => setPos(null), []);
  useDismiss(open, [buttonRef, menuRef], close);

  const active = options.find((o) => o.field === sortField);
  const isAsc = sortOrder === 'asc';

  let sortIcon = 'fa-sort';
  if (active) sortIcon = isAsc ? 'fa-sort-up' : 'fa-sort-down';

  let ariaSort;
  if (active) ariaSort = isAsc ? 'ascending' : 'descending';

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    const rect = buttonRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + 6,
      // rata kanan dengan tombol, tapi tidak keluar dari layar
      left: Math.min(Math.max(8, rect.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8),
    });
  };

  const tooltip = active
    ? `Sorted by ${active.label.toLowerCase()} (${isAsc ? 'oldest' : 'newest'} first). Click to change.`
    : 'Click to choose sort';

  return (
    <th className={`h-11 px-4 py-0 border-b border-line font-semibold whitespace-nowrap hover:bg-subtle ${className}`} aria-sort={ariaSort}>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        title={tooltip}
        className="w-full flex items-center gap-2 cursor-pointer select-none"
      >
        <span className="truncate">{label}</span>
        <i className={`fa ${sortIcon} ${active ? 'text-primary' : 'opacity-40'}`} />
        {/* field yang aktif ditampilkan sebaris (bukan baris kedua) agar tinggi header tetap */}
        {active && (
          <span className="shrink-0 rounded bg-primary-soft text-primary-soft-fg px-1.5 text-[11px] font-normal leading-5">
            {active.shortLabel || active.label}
          </span>
        )}
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: MENU_WIDTH }}
          className="z-50 bg-surface text-fg rounded-md shadow-lg border border-line py-1 text-sm"
        >
          {options.map((option, i) => (
            <div key={option.field} className={i > 0 ? 'border-t border-line-soft mt-1 pt-1' : ''}>
              <div className="px-3 pt-1 pb-0.5 text-xs font-semibold text-muted uppercase">{option.label}</div>
              {SORT_DIRECTIONS.map(({ order, text, icon }) => {
                const isActive = option.field === sortField && order === sortOrder;
                return (
                  <button
                    key={order}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    onClick={() => {
                      onSelect(option.field, order);
                      close();
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left cursor-pointer hover:bg-subtle ${
                      isActive ? 'text-primary font-semibold' : ''
                    }`}
                  >
                    <i className={`fa ${icon} w-4 text-center`} />
                    <span className="flex-1">{text}</span>
                    {isActive && <i className="fa fa-check text-xs" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>,
        document.body
      )}
    </th>
  );
}
