import { useEffect, useRef, useState } from 'react';
import { searchStockSkus } from '../../services/stockService';
import useDismiss from '../../hooks/useDismiss';
import { inputClass } from '../../utils/formStyles';
import { formatNumber } from '../../utils/formatHelper';

/**
 * Cari SKU lintas produk (kode SKU / nama produk) lalu tambahkan ke baris dokumen.
 * `existing` = Set id SKU yang sudah ada di dokumen (ditandai, tidak bisa ditambah lagi).
 * `searchFn(token, params)` = endpoint pencarian (default: Stock Adjustment), hasil berbentuk sama.
 */
export default function SkuPicker({ token, gudang, existing, onAdd, searchFn = searchStockSkus }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef(null);
  const inputRef = useRef(null);

  useDismiss(open, [boxRef], () => setOpen(false));

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return undefined;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await searchFn(token, { search: q, gudang });
        if (!cancelled) {
          setResults(data);
          setActive(0);
          setOpen(true);
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, gudang, token, searchFn]);

  const pick = (s) => {
    if (existing.has(s._id)) return;
    onAdd([s]);
    setQuery('');
    setResults([]);
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (e) => {
    if (!open || !results.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(results[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={boxRef} className="relative flex-1 min-w-56 max-w-lg">
      <i className="fa fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm"></i>
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls="sku-picker-list"
        aria-label="Search SKU to add"
        placeholder="Tambah SKU: ketik kode SKU atau nama produk..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onKeyDown={onKeyDown}
        className={`${inputClass} pl-9`}
      />
      {loading && <i className="fa fa-spinner fa-spin absolute right-3 top-1/2 -translate-y-1/2 text-muted text-sm"></i>}

      {open && (
        <ul
          id="sku-picker-list"
          role="listbox"
          className="absolute z-20 mt-1 w-full max-h-72 overflow-auto rounded-md border border-line bg-surface shadow-lg"
        >
          {results.length === 0 && <li className="px-3 py-2 text-sm text-muted">SKU tidak ditemukan</li>}
          {results.map((s, i) => {
            const added = existing.has(s._id);
            return (
              <li
                key={s._id}
                role="option"
                aria-selected={i === active}
                aria-disabled={added}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s);
                }}
                className={`px-3 py-2 text-sm flex items-center justify-between gap-3
                  ${added ? 'opacity-50 cursor-default' : 'cursor-pointer'} ${i === active ? 'bg-subtle' : ''}`}
              >
                <span className="min-w-0">
                  <span className="font-mono text-xs font-semibold text-fg">{s.sku}</span>
                  {!s.isActive && <span className="ml-1.5 text-[10px] px-1 rounded bg-subtle text-muted">inactive</span>}
                  <span className="block text-xs text-muted truncate">{s.produk?.name} · {s.variant}</span>
                </span>
                <span className="shrink-0 text-xs text-muted tabular-nums">
                  {added ? 'added' : `${formatNumber(s.qty)} ${s.uom}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
