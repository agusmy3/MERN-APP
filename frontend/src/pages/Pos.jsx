import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getPosContext, searchPosSkus, getPosPrices, openShift, cashMove, closeShift, createPosSale, getPosReceipt,
} from '../services/posService';
import { getCustomerDropdown } from '../services/salesService';
import { useAuth } from '../context/AuthContext';
import usePermission from '../hooks/usePermission';
import useToast from '../hooks/useToast';
import { inputClass } from '../utils/formStyles';
import { formatNumber, formatRupiah, round2 } from '../utils/formatHelper';
import { formatDate2 } from '../utils/dateHelper';
import { PAYMENT_METHODS, salesLineSubtotal, salesTotals } from '../utils/salesMeta';
import { printReceipt } from '../utils/receiptPrint';

const btn = 'px-4 py-2 rounded text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
const btnGhost = `${btn} border border-line hover:bg-subtle`;
const btnPrimary = `${btn} bg-primary hover:bg-primary-hover text-primary-fg`;
const cellInput = 'w-full bg-input text-fg border border-line rounded px-2 py-1 text-sm focus:outline-none focus:border-primary';

/** Dialog sederhana (overlay) */
function Modal({ title, onClose, children, width = 'max-w-md' }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`w-full ${width} rounded-lg bg-surface text-fg shadow-xl border border-line max-h-[90vh] overflow-auto`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <h3 className="font-semibold">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 rounded hover:bg-subtle cursor-pointer"><i className="fa fa-xmark"></i></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

/** Belum ada shift: pilih outlet + modal awal */
function OpenShift({ ctx, token, onOpened, canCreate }) {
  const toast = useToast();
  const [outlet, setOutlet] = useState(ctx.outlets[0]?._id || '');
  const [cash, setCash] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!outlet) return toast.warning('Pilih outlet.');
    setBusy(true);
    try {
      const res = await openShift({ outlet, openingCash: Number(cash) || 0 }, token);
      toast.success(res.data.message);
      onOpened();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to open shift');
    } finally {
      setBusy(false);
    }
  };
  if (!ctx.outlets.length) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center">
        <i className="fa fa-store text-4xl text-muted mb-3"></i>
        <p className="text-lg font-semibold">Belum ada outlet untuk Anda</p>
        <p className="text-muted text-sm">Minta admin menugaskan Anda ke outlet POS di menu User.</p>
      </div>
    );
  }
  return (
    <div className="h-full flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 space-y-4 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">Buka shift</h2>
          <p className="text-sm text-muted">Hitung uang di laci sebagai modal awal.</p>
        </div>
        <label className="block text-sm">Outlet
          <select value={outlet} onChange={(e) => setOutlet(e.target.value)} className={`${inputClass} mt-1`}>
            {ctx.outlets.map((o) => <option key={o._id} value={o._id}>{o.name} ({o.code}) · {o.gudang?.code}</option>)}
          </select>
        </label>
        <label className="block text-sm">Modal awal (Rp)
          <input type="number" min="0" step="0.01" autoFocus value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0" className={`${inputClass} mt-1 text-right tabular-nums`} />
        </label>
        <button type="submit" disabled={busy || !canCreate} className={`${btnPrimary} w-full`}><i className="fa fa-lock-open"></i> Buka shift</button>
        {!canCreate && <p className="text-xs text-danger">Role Anda tidak punya izin transaksi POS.</p>}
      </form>
    </div>
  );
}

/** Ringkasan shift (dipakai di dialog tutup shift) */
function ShiftSummary({ shift }) {
  const s = shift.summary;
  return (
    <dl className="grid grid-cols-2 gap-y-1 text-sm">
      <dt className="text-muted">Transaksi</dt><dd className="text-right tabular-nums">{s.salesCount}</dd>
      <dt className="text-muted">Total penjualan</dt><dd className="text-right tabular-nums">{formatRupiah(s.salesTotal)}</dd>
      {Object.entries(s.byMethod).map(([m, v]) => (
        <FragmentRow key={m} label={`· ${PAYMENT_METHODS[m] || m}`} value={formatRupiah(v)} />
      ))}
      <dt className="text-muted pt-2 border-t border-line-soft">Modal awal</dt><dd className="text-right tabular-nums pt-2 border-t border-line-soft">{formatRupiah(shift.openingCash)}</dd>
      {s.cashIn > 0 && <FragmentRow label="Kas masuk" value={`+${formatRupiah(s.cashIn)}`} />}
      {s.cashOut > 0 && <FragmentRow label="Kas keluar" value={`−${formatRupiah(s.cashOut)}`} />}
      <dt className="font-semibold">Kas seharusnya</dt><dd className="text-right tabular-nums font-semibold">{formatRupiah(s.expectedCash)}</dd>
    </dl>
  );
}
function FragmentRow({ label, value }) {
  return <><dt className="text-muted">{label}</dt><dd className="text-right tabular-nums">{value}</dd></>;
}

/**
 * Layar kasir POS (/pos): shift wajib dibuka. Scan barcode / ketik kode / nama (Enter = tambah),
 * keranjang dengan qty & diskon %, customer (price list), bayar split (F9), struk (cetak), kas
 * masuk/keluar, tutup shift dengan hitung uang. Harga dibekukan (price list / harga jual SKU).
 */
export default function Pos() {
  const { user } = useAuth();
  const perm = usePermission('pos');
  const toast = useToast();
  const [ctx, setCtx] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [customer, setCustomer] = useState('');
  const [cart, setCart] = useState([]);
  const [discountAmount, setDiscountAmount] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [active, setActive] = useState(0);
  const [modal, setModal] = useState(null); // pay | done | cash | close
  const [busy, setBusy] = useState(false);
  const searchRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const c = await getPosContext(user.token);
      setCtx(c);
      setCustomer((cur) => cur || c.walkIn?._id || '');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load POS');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.token]);

  useEffect(() => {
    load();
    getCustomerDropdown(user.token).then(setCustomers).catch(console.error);
  }, [load, user.token]);

  const shift = ctx?.shift;
  const outlet = shift?.outlet;
  const priceIncludesTax = outlet?.priceIncludesTax !== false;
  const totals = useMemo(() => salesTotals(cart, { discountAmount, taxRate: ctx?.taxRate || 0, priceIncludesTax }), [cart, discountAmount, ctx, priceIncludesTax]);
  const focusSearch = () => setTimeout(() => searchRef.current?.focus(), 0);

  // ---------- cari / scan ----------
  useEffect(() => {
    const q = query.trim();
    if (!q || !shift) {
      setResults([]);
      return undefined;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const data = await searchPosSkus(user.token, { search: q, customer });
        if (!cancelled) {
          setResults(data);
          setActive(0);
        }
      } catch (err) {
        console.error(err);
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, customer, shift, user.token]);

  const addToCart = (s) => {
    setCart((prev) => {
      const i = prev.findIndex((l) => l.sku === s._id);
      if (i >= 0) return prev.map((l, j) => (j === i ? { ...l, qty: round2(Number(l.qty) + 1) } : l));
      return [...prev, {
        sku: s._id, code: s.sku, name: s.produk?.name || '', variant: s.variant, uom: s.uom,
        stock: s.qty, hargaJual: s.price, priceSource: s.priceSource, qty: 1, diskonPersen: 0,
      }];
    });
    if (s.qty <= 0) toast.warning(`${s.sku}: stok di gudang ${shift?.gudang?.code} habis.`);
    setQuery('');
    setResults([]);
    focusSearch();
  };

  const onSearchKey = async (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const q = query.trim();
      if (!q) return;
      // scanner mengetik cepat lalu Enter: cari langsung, barcode / kode persis langsung masuk
      let list = results;
      if (!list.length || !list.some((r) => r.exact && (r.barcode === q || r.sku === q.toUpperCase()))) {
        try {
          list = await searchPosSkus(user.token, { search: q, customer });
          setResults(list);
          setActive(0);
        } catch (err) {
          return toast.error(err.response?.data?.message || 'Search failed');
        }
      }
      const exact = list.find((r) => r.exact);
      if (exact) return addToCart(exact);
      if (list.length === 1) return addToCart(list[0]);
      if (list[active]) return addToCart(list[active]);
      toast.warning(`"${q}" tidak ditemukan.`);
    }
  };

  const setLine = (sku, field, value) => setCart((prev) => prev.map((l) => (l.sku === sku ? { ...l, [field]: value } : l)));
  const removeLine = (sku) => setCart((prev) => prev.filter((l) => l.sku !== sku));
  const resetSale = () => {
    setCart([]);
    setDiscountAmount('');
    setCustomer(ctx?.walkIn?._id || '');
    focusSearch();
  };

  const changeCustomer = async (id) => {
    setCustomer(id);
    if (!cart.length) return;
    try {
      const prices = await getPosPrices(user.token, id, cart.map((l) => l.sku));
      setCart((prev) => prev.map((l) => (prices[l.sku] ? { ...l, hargaJual: prices[l.sku].price, priceSource: prices[l.sku].source } : l)));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load prices');
    }
  };

  // ---------- shortcut ----------
  useEffect(() => {
    const onKey = (e) => {
      if (modal) return;
      if (e.key === 'F2') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'F9' && cart.length) { e.preventDefault(); setModal('pay'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, cart.length]);

  if (!ctx) return <div className="p-6 text-muted">Loading...</div>;
  if (!shift) return <OpenShift ctx={ctx} token={user.token} onOpened={load} canCreate={perm.canCreate} />;

  const over = cart.filter((l) => Number(l.qty) > l.stock).length;

  return (
    <div className="h-full flex flex-col">
      {/* ---------- bar shift ---------- */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 border-b border-line bg-surface text-sm">
        <span className="font-semibold"><i className="fa fa-store mr-1.5 text-muted"></i>{outlet?.name}</span>
        <span className="text-muted">{shift.no} · {shift.cashier?.name} · buka {formatDate2(shift.openedAt)}</span>
        <span className="text-muted">{shift.summary.salesCount} trx · {formatRupiah(shift.summary.salesTotal)}</span>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={() => setModal('cash')} className={btnGhost}><i className="fa fa-money-bill-transfer"></i> Kas masuk/keluar</button>
          <button type="button" onClick={() => setModal('close')} className={btnGhost}><i className="fa fa-lock"></i> Tutup shift</button>
        </div>
      </div>

      <div className="min-h-0 flex-1 grid lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ---------- keranjang ---------- */}
        <div className="min-h-0 flex flex-col p-4 gap-3">
          <div className="relative">
            <i className="fa fa-barcode absolute left-3 top-1/2 -translate-y-1/2 text-muted"></i>
            <input
              ref={searchRef}
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKey}
              placeholder="Scan barcode / ketik kode SKU atau nama produk, Enter untuk tambah (F2)"
              aria-label="Scan or search product"
              className={`${inputClass} pl-10 py-3 text-base`}
            />
            {results.length > 0 && query.trim() && (
              <ul className="absolute z-20 mt-1 w-full max-h-80 overflow-auto overscroll-contain rounded-md border border-line bg-surface shadow-lg">
                {results.map((r, i) => (
                  <li key={r._id}>
                    <button type="button" onMouseDown={(e) => { e.preventDefault(); addToCart(r); }} onMouseEnter={() => setActive(i)}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-3 cursor-pointer ${i === active ? 'bg-subtle' : ''}`}>
                      <span className="min-w-0">
                        <span className="font-mono text-xs font-semibold">{r.sku}</span>
                        {r.barcode && <span className="ml-2 font-mono text-[10px] text-muted">{r.barcode}</span>}
                        <span className="block text-xs text-muted truncate">{r.produk?.name} · {r.variant}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block tabular-nums">{formatRupiah(r.price)}</span>
                        <span className={`block text-[10px] ${r.qty > 0 ? 'text-muted' : 'text-danger'}`}>stok {formatNumber(r.qty)} {r.uom}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: 640 }}>
              <thead className="bg-head text-head-fg text-left sticky top-0">
                <tr>
                  <th className="px-3 py-2 border-b border-line font-semibold">Item</th>
                  <th className="px-3 py-2 border-b border-line font-semibold w-36 text-center">Qty</th>
                  <th className="px-3 py-2 border-b border-line font-semibold w-28 text-right">Price</th>
                  <th className="px-3 py-2 border-b border-line font-semibold w-20 text-right">Disc %</th>
                  <th className="px-3 py-2 border-b border-line font-semibold w-32 text-right">Subtotal</th>
                  <th className="px-3 py-2 border-b border-line w-10"></th>
                </tr>
              </thead>
              <tbody>
                {cart.map((l) => {
                  const short = Number(l.qty) > l.stock;
                  return (
                    <tr key={l.sku} className={short ? 'bg-danger-soft' : ''}>
                      <td className="px-3 py-1.5 border-t border-line-soft">
                        <div className="font-medium truncate max-w-72">{l.name} <span className="text-muted font-normal">· {l.variant}</span></div>
                        <div className="text-xs text-muted font-mono">{l.code}{short && <span className="ml-2 font-sans text-danger">stok {formatNumber(l.stock)}</span>}</div>
                      </td>
                      <td className="px-3 py-1.5 border-t border-line-soft">
                        <div className="flex items-center gap-1">
                          <button type="button" aria-label={`Kurangi ${l.code}`} onClick={() => setLine(l.sku, 'qty', Math.max(round2(Number(l.qty) - 1), 1))} className="w-7 h-7 rounded border border-line hover:bg-subtle cursor-pointer">−</button>
                          <input aria-label={`Qty ${l.code}`} type="number" min="0.01" step="0.01" value={l.qty}
                            onChange={(e) => setLine(l.sku, 'qty', e.target.value)} className={`${cellInput} text-center tabular-nums`} />
                          <button type="button" aria-label={`Tambah ${l.code}`} onClick={() => setLine(l.sku, 'qty', round2(Number(l.qty) + 1))} className="w-7 h-7 rounded border border-line hover:bg-subtle cursor-pointer">+</button>
                        </div>
                      </td>
                      <td className="px-3 py-1.5 border-t border-line-soft text-right tabular-nums">
                        {formatRupiah(l.hargaJual)}
                        {l.priceSource === 'list' && <div className="text-[10px] text-primary">price list</div>}
                      </td>
                      <td className="px-3 py-1.5 border-t border-line-soft">
                        <input aria-label={`Discount ${l.code}`} type="number" min="0" max="100" step="0.01" value={l.diskonPersen}
                          onChange={(e) => setLine(l.sku, 'diskonPersen', e.target.value)} className={`${cellInput} text-right tabular-nums`} />
                      </td>
                      <td className="px-3 py-1.5 border-t border-line-soft text-right tabular-nums font-medium">{formatRupiah(salesLineSubtotal(l))}</td>
                      <td className="px-3 py-1.5 border-t border-line-soft text-center">
                        <button type="button" aria-label={`Hapus ${l.code}`} onClick={() => removeLine(l.sku)} className="w-8 h-8 rounded-md text-muted hover:text-danger hover:bg-danger-soft cursor-pointer"><i className="fa fa-xmark"></i></button>
                      </td>
                    </tr>
                  );
                })}
                {cart.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-16 text-muted"><i className="fa fa-barcode text-3xl block mb-2"></i>Scan barang untuk memulai.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ---------- total & bayar ---------- */}
        <aside className="min-h-0 overflow-auto border-l border-line bg-surface p-4 flex flex-col gap-4">
          <label className="block text-sm">Customer
            <select value={customer} onChange={(e) => changeCustomer(e.target.value)} className={`${inputClass} mt-1`}>
              {customers.filter((c) => c.isActive !== false).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted">Diskon transaksi (Rp)</span>
            <input type="number" min="0" step="0.01" value={discountAmount} onChange={(e) => setDiscountAmount(e.target.value)} className={`${cellInput} w-32 text-right tabular-nums`} aria-label="Transaction discount" />
          </label>
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted">Subtotal</dt><dd className="text-right tabular-nums">{formatRupiah(totals.subtotal)}</dd>
            {totals.discountAmount > 0 && <FragmentRow label="Diskon" value={`−${formatRupiah(totals.discountAmount)}`} />}
            <dt className="text-muted">PPN {formatNumber(ctx.taxRate)}%{priceIncludesTax ? ' (incl.)' : ''}</dt><dd className="text-right tabular-nums">{formatRupiah(totals.taxAmount)}</dd>
          </dl>
          <div className="rounded-lg bg-subtle p-4 text-right">
            <div className="text-xs text-muted">TOTAL</div>
            <div className="text-3xl font-bold tabular-nums">{formatRupiah(totals.total)}</div>
          </div>
          {over > 0 && <p className="text-sm text-danger"><i className="fa fa-triangle-exclamation mr-1"></i>{over} barang melebihi stok: transaksi akan ditolak.</p>}
          <button type="button" disabled={!cart.length || busy || !perm.canCreate} onClick={() => setModal('pay')} className={`${btnPrimary} py-3 text-base`}>
            <i className="fa fa-money-bill-wave"></i> Bayar (F9)
          </button>
          {cart.length > 0 && <button type="button" onClick={resetSale} className={btnGhost}><i className="fa fa-trash"></i> Kosongkan</button>}

          {shift.recent?.length > 0 && (
            <div className="mt-auto pt-3 border-t border-line-soft">
              <div className="text-xs font-semibold text-muted mb-1">Transaksi terakhir</div>
              <ul className="space-y-1 text-xs">
                {shift.recent.slice(0, 5).map((r) => (
                  <li key={r._id} className="flex items-center justify-between gap-2">
                    <span className="font-mono">{r.no}</span>
                    <span className="tabular-nums">{formatRupiah(r.total)}</span>
                    <button type="button" title="Cetak ulang struk" onClick={async () => printReceipt(await getPosReceipt(r._id, user.token))}
                      className="text-muted hover:text-primary cursor-pointer"><i className="fa fa-print"></i></button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>

      {modal === 'pay' && (
        <PayDialog
          total={totals.total}
          busy={busy}
          onClose={() => { setModal(null); focusSearch(); }}
          onPay={async (payments) => {
            setBusy(true);
            try {
              const res = await createPosSale({
                customer,
                lines: cart.map((l) => ({ sku: l.sku, qty: l.qty, diskonPersen: l.diskonPersen || 0 })),
                discountAmount: Number(discountAmount) || 0,
                payments,
              }, user.token);
              const receipt = await getPosReceipt(res.data.data._id, user.token);
              setModal({ done: receipt });
              setCart([]);
              setDiscountAmount('');
              setCustomer(ctx.walkIn?._id || '');
              load();
            } catch (err) {
              toast.error(err.response?.data?.message || 'Failed to save sale');
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      {modal?.done && (
        <Modal title={`Transaksi ${modal.done.no}`} onClose={() => { setModal(null); focusSearch(); }}>
          <div className="text-center space-y-2">
            <i className="fa fa-circle-check text-4xl text-success-fg"></i>
            <div className="text-sm text-muted">Total {formatRupiah(modal.done.total)}</div>
            {modal.done.change > 0 && (<><div className="text-sm text-muted">Kembalian</div><div className="text-4xl font-bold tabular-nums">{formatRupiah(modal.done.change)}</div></>)}
          </div>
          <div className="mt-6 flex gap-2">
            <button type="button" onClick={() => printReceipt(modal.done)} className={`${btnGhost} flex-1`}><i className="fa fa-print"></i> Cetak struk</button>
            <button type="button" autoFocus onClick={() => { setModal(null); focusSearch(); }} className={`${btnPrimary} flex-1`}>Transaksi baru</button>
          </div>
        </Modal>
      )}
      {modal === 'cash' && <CashDialog token={user.token} expected={shift.summary.expectedCash} onClose={() => { setModal(null); focusSearch(); }} onDone={load} />}
      {modal === 'close' && <CloseDialog token={user.token} shift={shift} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
    </div>
  );
}

/** Pembayaran: split per metode, tombol uang cepat, kembalian dari tunai */
function PayDialog({ total, busy, onClose, onPay }) {
  const toast = useToast();
  const [rows, setRows] = useState([{ method: 'CASH', amount: '', reference: '' }]);
  const paid = round2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const nonCash = round2(rows.filter((r) => r.method !== 'CASH').reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const change = round2(paid - total);
  const quick = [...new Set([total, Math.ceil(total / 10000) * 10000, Math.ceil(total / 50000) * 50000, Math.ceil(total / 100000) * 100000])].filter((v) => v >= total).slice(0, 4);
  const setRow = (i, k, v) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const submit = (e) => {
    e.preventDefault();
    if (nonCash > total) return toast.warning('Pembayaran non-tunai tidak boleh melebihi total.');
    if (paid < total) return toast.warning(`Kurang ${formatRupiah(total - paid)}.`);
    onPay(rows.filter((r) => Number(r.amount) > 0).map((r) => ({ method: r.method, amount: Number(r.amount), reference: r.reference })));
  };
  return (
    <Modal title="Pembayaran" onClose={onClose} width="max-w-lg">
      <form onSubmit={submit} className="space-y-3">
        <div className="text-center"><div className="text-xs text-muted">TOTAL</div><div className="text-3xl font-bold tabular-nums">{formatRupiah(total)}</div></div>
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2">
            <select aria-label="Method" value={r.method} onChange={(e) => setRow(i, 'method', e.target.value)} className={`${inputClass} w-36`}>
              {Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input aria-label="Amount" type="number" min="0" step="0.01" autoFocus={i === 0} value={r.amount}
              onChange={(e) => setRow(i, 'amount', e.target.value)} className={`${inputClass} text-right tabular-nums`} placeholder="0" />
            {r.method !== 'CASH' && <input aria-label="Reference" value={r.reference} onChange={(e) => setRow(i, 'reference', e.target.value)} placeholder="Ref" className={`${inputClass} w-28`} />}
            {rows.length > 1 && <button type="button" aria-label="Remove" onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))} className="px-2 text-muted hover:text-danger cursor-pointer"><i className="fa fa-xmark"></i></button>}
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          {quick.map((v) => (
            <button key={v} type="button" onClick={() => setRows([{ method: 'CASH', amount: v, reference: '' }])} className={`${btnGhost} py-1`}>{formatRupiah(v)}</button>
          ))}
          <button type="button" onClick={() => setRows((prev) => [...prev, { method: 'QRIS', amount: Math.max(round2(total - paid), 0) || '', reference: '' }])} className={`${btnGhost} py-1`}>
            <i className="fa fa-plus"></i> Split
          </button>
        </div>
        <dl className="grid grid-cols-2 gap-y-1 text-sm pt-2 border-t border-line-soft">
          <dt className="text-muted">Dibayar</dt><dd className="text-right tabular-nums">{formatRupiah(paid)}</dd>
          <dt className={change < 0 ? 'text-danger' : 'font-semibold'}>{change < 0 ? 'Kurang' : 'Kembalian'}</dt>
          <dd className={`text-right tabular-nums text-xl font-bold ${change < 0 ? 'text-danger' : ''}`}>{formatRupiah(Math.abs(change))}</dd>
        </dl>
        <button type="submit" disabled={busy || paid < total} className={`${btnPrimary} w-full py-3 text-base`}><i className="fa fa-check"></i> Selesai (Enter)</button>
      </form>
    </Modal>
  );
}

function CashDialog({ token, expected, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ type: 'OUT', amount: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!(Number(f.amount) > 0) || !f.reason.trim()) return toast.warning('Isi jumlah dan alasan.');
    setBusy(true);
    try {
      const res = await cashMove({ ...f, amount: Number(f.amount) }, token);
      toast.success(res.data.message);
      onDone();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Kas masuk / keluar" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3 text-sm">
        <div className="flex gap-2">
          {[['OUT', 'Kas keluar'], ['IN', 'Kas masuk']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setF((p) => ({ ...p, type: k }))}
              className={`${btn} flex-1 border ${f.type === k ? 'border-primary bg-primary-soft text-primary-soft-fg' : 'border-line'}`}>{l}</button>
          ))}
        </div>
        <p className="text-xs text-muted">Kas di laci seharusnya {formatRupiah(expected)}.</p>
        <input type="number" min="0.01" step="0.01" autoFocus value={f.amount} onChange={(e) => setF((p) => ({ ...p, amount: e.target.value }))} placeholder="Jumlah" aria-label="Amount" className={`${inputClass} text-right tabular-nums`} />
        <input value={f.reason} onChange={(e) => setF((p) => ({ ...p, reason: e.target.value }))} placeholder="Alasan, mis. beli galon / setor ke kantor" aria-label="Reason" maxLength={200} className={inputClass} />
        <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>Simpan</button>
      </form>
    </Modal>
  );
}

function CloseDialog({ token, shift, onClose, onDone }) {
  const toast = useToast();
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const diff = counted === '' ? null : round2(Number(counted) - shift.summary.expectedCash);
  const submit = async (e) => {
    e.preventDefault();
    if (counted === '') return toast.warning('Isi jumlah uang fisik di laci.');
    if (diff !== 0 && !note.trim()) return toast.warning('Ada selisih: isi catatan.');
    setBusy(true);
    try {
      const res = await closeShift({ closingCash: Number(counted), note }, token);
      toast.success(res.data.message);
      onDone();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to close shift');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Tutup shift ${shift.no}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4 text-sm">
        <ShiftSummary shift={shift} />
        <label className="block">Uang fisik di laci (Rp)
          <input type="number" min="0" step="0.01" autoFocus value={counted} onChange={(e) => setCounted(e.target.value)} className={`${inputClass} mt-1 text-right tabular-nums text-lg`} />
        </label>
        {diff !== null && (
          <div className={`rounded p-2 text-center font-semibold ${diff === 0 ? 'bg-success-soft text-success-fg' : 'bg-danger-soft text-danger'}`}>
            {diff === 0 ? 'Pas, tidak ada selisih' : `Selisih ${diff > 0 ? '+' : '−'}${formatRupiah(Math.abs(diff))}`}
          </div>
        )}
        <label className="block">Catatan{diff ? <span className="text-danger"> *</span> : ''}
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={`${inputClass} mt-1`} placeholder={diff ? 'Jelaskan selisih' : 'Optional'} />
        </label>
        <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}><i className="fa fa-lock"></i> Tutup shift</button>
      </form>
    </Modal>
  );
}
