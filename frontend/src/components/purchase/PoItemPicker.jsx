import { useEffect, useRef, useState } from 'react';
import { searchPoItems } from '../../services/purchaseService';
import useDismiss from '../../hooks/useDismiss';
import { inputClass } from '../../utils/formStyles';
import { formatRupiah } from '../../utils/formatHelper';

/**
 * Cari SKU untuk baris PO (kode SKU / nama produk) + harga dari vendor terpilih.
 * Kolom kosong saat fokus = daftar SKU yang punya harga dari vendor ini.
 */
export default function PoItemPicker({ token, vendor, onAdd }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const boxRef = useRef(null);

  useDismiss(open, [boxRef], () => setOpen(false));

  useEffect(() => {
    if (!vendor || !focused) return undefined;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await searchPoItems(token, { vendor, search: query.trim() });
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
    }, query ? 300 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, vendor, token, focused]);

  const pick = (item) => {
    onAdd(item);
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (!open || !results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(results[active]); }
  };

  const bestPrice = (item) => item.prices.find((p) => p.isPreferred) || item.prices[0];

  return (
    <div ref={boxRef} className="relative flex-1 min-w-56 max-w-xl">
      <i className="fa fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm"></i>
      <input
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls="po-item-list"
        aria-label="Search item to add"
        disabled={!vendor}
        placeholder={vendor ? 'Tambah item: ketik kode SKU / nama produk (kosong = item vendor ini)' : 'Pilih vendor dulu'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => { setFocused(true); if (results.length) setOpen(true); }}
        onKeyDown={onKeyDown}
        className={`${inputClass} pl-9`}
      />
      {loading && <i className="fa fa-spinner fa-spin absolute right-3 top-1/2 -translate-y-1/2 text-muted text-sm"></i>}

      {open && (
        <ul id="po-item-list" role="listbox" className="absolute z-20 mt-1 w-full max-h-80 overflow-auto rounded-md border border-line bg-surface shadow-lg">
          {results.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted">{query ? 'SKU tidak ditemukan' : 'Vendor ini belum punya daftar harga. Ketik untuk mencari SKU.'}</li>
          )}
          {results.map((item, i) => {
            const price = bestPrice(item);
            return (
              <li
                key={item._id}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(item); }}
                className={`px-3 py-2 text-sm flex items-center justify-between gap-3 cursor-pointer ${i === active ? 'bg-subtle' : ''}`}
              >
                <span className="min-w-0">
                  <span className="font-mono text-xs font-semibold text-fg">{item.sku}</span>
                  <span className="block text-xs text-muted truncate">{item.produk?.name} · {item.variant}</span>
                </span>
                <span className="shrink-0 text-xs text-right tabular-nums">
                  {price
                    ? <>{formatRupiah(price.hargaBeli)} / {price.uomBeli?.code}{item.prices.length > 1 && <span className="text-muted"> (+{item.prices.length - 1})</span>}</>
                    : <span className="text-muted">no vendor price</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
