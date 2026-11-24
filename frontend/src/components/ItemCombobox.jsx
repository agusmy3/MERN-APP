import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import useDismiss from '../hooks/useDismiss';
import { inputClass } from '../utils/formStyles';

const GAP = 4;
const MARGIN = 8;
const MIN_WIDTH = 440;
const MAX_HEIGHT = 460;

/**
 * Combobox untuk menambah baris dokumen: tombol pemicu -> panel (search bar + tab opsional + daftar
 * yang bisa di-scroll). Panel di-render ke <body> dengan posisi fixed, jadi tidak terpotong container
 * halaman, dan membuka ke atas bila ruang di bawah sempit. Panel tetap terbuka setelah memilih
 * (tambah beberapa item sekaligus); item yang sudah ada ditandai "added".
 *
 * Props:
 * - fetchItems({ query, tab }) -> Promise<item[]> (item wajib punya _id)
 * - tabs: [{ key, label, requireQuery?, emptyText?, limit? }] (opsional); tanpa tabs pakai requireQuery / emptyText
 * - limit: jumlah maks. hasil dari server (untuk petunjuk "ketik untuk mempersempit")
 * - renderItem(item) -> isi kiri; renderMeta(item, added) -> isi kanan
 * - isAdded(item), addedSelectable (boleh dipilih lagi meski sudah ada)
 * - onPick(item)
 */
export default function ItemCombobox({
  label,
  disabled,
  disabledText,
  searchPlaceholder = 'Ketik kode SKU atau nama produk...',
  tabs,
  requireQuery = false,
  emptyText,
  limit,
  fetchItems,
  renderItem,
  renderMeta,
  isAdded = () => false,
  addedSelectable = false,
  onPick,
  className = 'flex-1 min-w-56 max-w-xl',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState(tabs?.[0]?.key ?? null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);

  const tabDef = tabs?.find((t) => t.key === tab);
  const needQuery = tabDef ? !!tabDef.requireQuery : requireQuery;
  const q = query.trim();

  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, [triggerRef, panelRef], close);

  const openPanel = (initial = '') => {
    if (disabled) return;
    setQuery(initial);
    setOpen(true);
  };

  // posisi panel: di bawah tombol, atau di atas bila ruang bawah sempit
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(Math.max(r.width, MIN_WIDTH), vw - MARGIN * 2);
    const left = Math.min(Math.max(r.left, MARGIN), vw - width - MARGIN);
    const below = vh - r.bottom - GAP - MARGIN;
    const above = r.top - GAP - MARGIN;
    const up = below < 280 && above > below;
    const maxHeight = Math.min(MAX_HEIGHT, up ? above : below);
    setPos(up
      ? { left, width, maxHeight, bottom: vh - r.top + GAP }
      : { left, width, maxHeight, top: r.bottom + GAP });
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  // muat hasil: langsung saat query kosong / ganti tab, debounce saat mengetik
  useEffect(() => {
    if (!open) return undefined;
    if (needQuery && !q) {
      setItems([]);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await fetchItems({ query: q, tab });
        if (!cancelled) {
          setItems(data || []);
          setActive(0);
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, q ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, q, tab, needQuery, fetchItems]);

  // item aktif selalu terlihat saat navigasi keyboard
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const selectable = (item) => addedSelectable || !isAdded(item);
  const pick = (item) => {
    if (!item || !selectable(item)) return;
    onPick(item);
    searchRef.current?.focus();
  };

  const onSearchKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(items[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); triggerRef.current?.focus(); }
    else if (e.key === 'Tab') close();
  };

  // ketik langsung di tombol = buka panel dengan huruf tsb
  const onTriggerKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); openPanel(); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== ' ') { e.preventDefault(); openPanel(e.key); }
  };

  const empty = needQuery && !q
    ? (tabDef?.emptyText || emptyText || 'Ketik untuk mencari.')
    : (q ? 'Tidak ada yang cocok.' : (tabDef?.emptyText || emptyText || 'Tidak ada data.'));

  return (
    <div className={className}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : openPanel())}
        onKeyDown={onTriggerKey}
        className={`${inputClass} flex items-center gap-2 text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-60`}
      >
        <i className="fa fa-plus text-xs text-muted"></i>
        <span className="flex-1 truncate text-muted">{disabled && disabledText ? disabledText : label}</span>
        <i className={`fa fa-chevron-down text-xs text-muted transition-transform ${open ? 'rotate-180' : ''}`}></i>
      </button>

      {open && pos && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label={label}
          style={{ position: 'fixed', left: pos.left, width: pos.width, maxHeight: pos.maxHeight, top: pos.top, bottom: pos.bottom }}
          className="z-50 flex flex-col rounded-md border border-line bg-surface text-fg shadow-lg"
        >
          <div className="p-2 border-b border-line-soft space-y-2">
            <div className="relative">
              <i className="fa fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm"></i>
              <input
                ref={searchRef}
                type="search"
                role="combobox"
                aria-expanded="true"
                aria-controls="item-combobox-list"
                aria-activedescendant={items[active] ? `item-combobox-${items[active]._id}` : undefined}
                aria-label="Search"
                placeholder={searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onSearchKey}
                className={`${inputClass} pl-9`}
              />
              {loading && <i className="fa fa-spinner fa-spin absolute right-3 top-1/2 -translate-y-1/2 text-muted text-sm"></i>}
            </div>
            {tabs?.length > 1 && (
              <div role="tablist" className="flex gap-1 text-xs">
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={t.key === tab}
                    onClick={() => { setTab(t.key); searchRef.current?.focus(); }}
                    className={`px-2.5 py-1 rounded-full border cursor-pointer ${t.key === tab
                      ? 'bg-primary text-primary-fg border-primary'
                      : 'border-line text-muted hover:text-fg hover:bg-subtle'}`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <ul id="item-combobox-list" ref={listRef} role="listbox" className="flex-1 min-h-0 overflow-auto overscroll-contain py-1">
            {items.length === 0 && !loading && <li className="px-3 py-3 text-sm text-muted">{empty}</li>}
            {items.map((item, i) => {
              const added = isAdded(item);
              const canPick = selectable(item);
              return (
                <li
                  key={item._id}
                  id={`item-combobox-${item._id}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  aria-disabled={!canPick}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => { e.preventDefault(); pick(item); }}
                  className={`px-3 py-2 text-sm flex items-center justify-between gap-3
                    ${canPick ? 'cursor-pointer' : 'opacity-50 cursor-default'} ${i === active ? 'bg-subtle' : ''}`}
                >
                  <span className="min-w-0">{renderItem(item)}</span>
                  <span className="shrink-0 text-xs text-right tabular-nums">
                    {renderMeta?.(item, added)}
                    {added && <span className="ml-1.5 px-1.5 rounded bg-primary-soft text-primary text-[10px] font-semibold">added</span>}
                  </span>
                </li>
              );
            })}
          </ul>

          <div className="px-3 py-1.5 border-t border-line-soft text-[11px] text-muted flex flex-wrap justify-between gap-x-3">
            <span>
              {items.length > 0 && `${items.length} item`}
              {(tabDef?.limit ?? limit) && items.length >= (tabDef?.limit ?? limit) && ' (maks. ditampilkan, ketik untuk mempersempit)'}
            </span>
            <span>↑↓ pilih · Enter tambah · Esc tutup</span>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Isi kiri standar: kode SKU (+ inactive) dan produk · varian. */
export function SkuLabel({ item }) {
  return (
    <>
      <span className="font-mono text-xs font-semibold text-fg">{item.sku}</span>
      {item.isActive === false && <span className="ml-1.5 text-[10px] px-1 rounded bg-subtle text-muted">inactive</span>}
      <span className="block text-xs text-muted truncate">{item.produk?.name} · {item.variant}</span>
    </>
  );
}
