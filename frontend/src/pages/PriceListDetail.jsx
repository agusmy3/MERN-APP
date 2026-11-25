import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  getPriceList,
  createPriceList,
  updatePriceList,
  deletePriceList,
  searchPriceListSkus,
} from '../services/salesService';
import { getProdukDropdown } from '../services/produkService';
import { getKategoriDropdown } from '../services/kategoriService';
import { useAuth } from '../context/AuthContext';
import usePermission from '../hooks/usePermission';
import useToast from '../hooks/useToast';
import useConfirm from '../hooks/useConfirm';
import PageHeader from '../components/PageHeader';
import FormField from '../components/FormField';
import SkuPicker from '../components/stock/SkuPicker';
import AuditTimeline from '../components/audit/AuditTimeline';
import { AuditDetail } from '../components/AuditInfo';
import { inputClass } from '../utils/formStyles';
import { formatNumber, formatRupiah, round2, variantLabel } from '../utils/formatHelper';

const cellInput = `w-full bg-input text-fg border border-line rounded px-2 py-1 text-sm
  focus:outline-none focus:border-primary disabled:bg-transparent disabled:border-transparent`;
const btn = 'px-4 py-2 rounded text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
const btnGhost = `${btn} border border-line hover:bg-subtle`;
const btnPrimary = `${btn} bg-primary hover:bg-primary-hover text-primary-fg`;
const btnDanger = `${btn} border border-danger-line text-danger hover:bg-danger-soft`;

const hasValue = (v) => v !== null && v !== undefined && v !== '';

const itemFromDoc = (it) => ({
  sku: { _id: it.sku?._id, sku: it.sku?.sku ?? '(deleted SKU)', produkName: it.produk?.name || '', variant: variantLabel(it.sku), uom: it.produk?.uom?.code || '' },
  defaultPrice: it.sku?.hargaJual ?? null,
  avgCost: it.sku?.avgCost ?? null,
  price: it.price,
});
const itemFromSearch = (s) => ({
  sku: { _id: s._id, sku: s.sku, produkName: s.produk?.name || '', variant: s.variant, uom: s.uom },
  defaultPrice: s.hargaJual ?? null,
  avgCost: s.avgCost ?? null,
  price: s.hargaJual ?? '',
});
const toPayload = (form, items) => ({ ...form, items: items.map((i) => ({ sku: i.sku._id, price: i.price })) });

/** Tambah semua SKU dari 1 produk / kategori */
function BulkAdd({ token, onLoad }) {
  const [mode, setMode] = useState('produk');
  const [options, setOptions] = useState({ produk: [], kategori: [] });
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    Promise.all([getProdukDropdown(token), getKategoriDropdown(token)])
      .then(([produk, kategori]) => setOptions({ produk, kategori }))
      .catch(console.error);
  }, [token]);
  const load = async () => {
    if (!value) return;
    setLoading(true);
    try {
      onLoad(await searchPriceListSkus(token, { [mode]: value }));
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Load by" value={mode} onChange={(e) => { setMode(e.target.value); setValue(''); }} className={`${inputClass} w-auto`}>
        <option value="produk">Product</option>
        <option value="kategori">Category</option>
      </select>
      <select aria-label={`Choose ${mode}`} value={value} onChange={(e) => setValue(e.target.value)} className={`${inputClass} w-auto max-w-56`}>
        <option value="">— choose {mode === 'produk' ? 'product' : 'category'} —</option>
        {options[mode].map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
      </select>
      <button type="button" onClick={load} disabled={!value || loading} className={btnGhost}>
        <i className="fa fa-download"></i> {loading ? 'Loading...' : 'Add all SKU'}
      </button>
    </div>
  );
}

/**
 * Price List: /price-list/:id (id = 'new'). Harga per SKU (satuan dasar); "Apply % from default" mengisi
 * semua harga = harga jual default x (1 - diskon%). Margin dari HPP hanya untuk vendorPrice:view.
 */
export default function PriceListDetail() {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const { user } = useAuth();
  const perm = usePermission('priceList');
  const customerPerm = usePermission('customer');
  const canSeeCost = usePermission('vendorPrice').canView;
  const toast = useToast();
  const confirm = useConfirm();

  const [doc, setDoc] = useState(null);
  const [notFound, setNotFound] = useState(null);
  const [form, setForm] = useState(null);
  const [items, setItems] = useState([]);
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [pct, setPct] = useState('');
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await getPriceList(id, user.token);
      const f = { code: d.code, name: d.name, deskripsi: d.deskripsi || '', isActive: d.isActive !== false };
      const its = d.items.map(itemFromDoc);
      setDoc(d);
      setForm(f);
      setItems(its);
      setSaved(JSON.stringify(toPayload(f, its)));
      setVersion((v) => v + 1);
    } catch (err) {
      const s = err.response?.status;
      if ([400, 403, 404].includes(s)) setNotFound(err.response?.data?.message || 'Price list mungkin sudah dihapus.');
      else console.error(err);
    }
  }, [id, user.token]);

  useEffect(() => {
    if (!isNew) {
      load();
      return;
    }
    setDoc(null);
    setItems([]);
    setSaved(null);
    setForm({ code: '', name: '', deskripsi: '', isActive: true });
  }, [isNew, load]);

  const editable = isNew ? perm.canCreate : perm.canUpdate;
  const payload = form ? toPayload(form, items) : null;
  const dirty = editable && (isNew || JSON.stringify(payload) !== saved);

  const existing = useMemo(() => new Set(items.map((i) => i.sku._id)), [items]);
  const addItems = (skus) => {
    const fresh = skus.filter((s) => !existing.has(s._id));
    if (!fresh.length) return toast.info('SKU tersebut sudah ada di price list.');
    setItems((prev) => [...prev, ...fresh.map(itemFromSearch)]);
    if (skus.length > 1) toast.success(`${fresh.length} SKU ditambahkan${fresh.length < skus.length ? ` (${skus.length - fresh.length} sudah ada)` : ''}.`);
  };
  const setPrice = (skuId, price) => setItems((prev) => prev.map((i) => (i.sku._id === skuId ? { ...i, price } : i)));
  const removeItem = (skuId) => setItems((prev) => prev.filter((i) => i.sku._id !== skuId));
  const applyPct = () => {
    const p = Number(pct);
    if (!(p >= 0 && p <= 100)) return toast.warning('Isi persentase 0 – 100.');
    setItems((prev) => prev.map((i) => (hasValue(i.defaultPrice) ? { ...i, price: round2(i.defaultPrice * (1 - p / 100)) } : i)));
  };

  const shown = filter.trim()
    ? items.filter((i) => `${i.sku.sku} ${i.sku.produkName} ${i.sku.variant}`.toLowerCase().includes(filter.trim().toLowerCase()))
    : items;

  const save = async () => {
    if (!form.code.trim() || !form.name.trim()) return toast.warning('Isi kode dan nama price list.');
    const bad = items.find((i) => !hasValue(i.price) || Number(i.price) < 0);
    if (bad) return toast.warning(`${bad.sku.sku}: isi harga (>= 0).`);
    setBusy(true);
    try {
      const res = isNew ? await createPriceList(payload, user.token) : await updatePriceList(id, payload, user.token);
      toast.success(res.data.message);
      if (isNew) navigate(`/price-list/${res.data.data._id}`, { replace: true });
      else await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save price list');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({ title: `Delete ${doc.code}?`, message: 'Price list ini akan dihapus permanen.', confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
    try {
      const res = await deletePriceList(id, user.token);
      toast.success(res.data.message);
      navigate('/price-list');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete price list');
    }
  };

  if (notFound) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <p className="text-xl font-semibold text-fg mb-1">Price list not available</p>
        <p className="text-muted mb-6">{notFound}</p>
        <Link to="/price-list" className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded">
          <i className="fa fa-arrow-left"></i> Back to Price List
        </Link>
      </div>
    );
  }
  if (!form) return <div className="p-6 text-muted">Loading...</div>;
  if (isNew && perm.loaded && !perm.canCreate) return <div className="p-6 text-muted">You don&apos;t have permission to create price lists.</div>;

  return (
    <div className="h-full p-4 flex flex-col overflow-auto">
      <PageHeader
        fallbackTitle="Price List"
        parentPath="/price-list"
        title={doc ? `${doc.code} — ${doc.name}` : 'New Price List'}
        subtitle="Harga jual khusus; dipakai di invoice untuk customer yang ditautkan ke price list ini."
        actions={(
          <>
            {!isNew && perm.canDelete && (
              <button type="button" onClick={remove} disabled={busy} className={btnDanger}><i className="fa fa-trash"></i> Delete</button>
            )}
            {editable && (
              <button type="button" onClick={save} disabled={busy || !dirty} className={btnPrimary}><i className="fa fa-save"></i> Save</button>
            )}
          </>
        )}
      />

      <div className={`grid gap-4 items-start ${doc ? 'xl:grid-cols-[minmax(0,1fr)_320px]' : ''}`}>
        <div className="space-y-4 min-w-0">
          <section className="rounded-lg border border-line bg-surface p-4">
            <fieldset disabled={!editable || busy} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <FormField label="Code" htmlFor="pl-code" required>
                <input id="pl-code" value={form.code} placeholder="e.g. GROSIR" autoComplete="off"
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))} className={inputClass} />
              </FormField>
              <FormField label="Name" htmlFor="pl-name" required>
                <input id="pl-name" value={form.name} autoComplete="off" onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={inputClass} />
              </FormField>
              <FormField label="Description" htmlFor="pl-desc">
                <input id="pl-desc" value={form.deskripsi} onChange={(e) => setForm((f) => ({ ...f, deskripsi: e.target.value }))} className={inputClass} />
              </FormField>
              <label className="flex items-center gap-2 text-sm cursor-pointer pt-6">
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} className="w-4 h-4 accent-primary" />
                <span>Active <span className="block text-xs text-muted">Nonaktif = customer kembali ke harga default.</span></span>
              </label>
            </fieldset>
          </section>

          <section className="rounded-lg border border-line bg-surface">
            <div className="px-4 py-3 border-b border-line flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-fg">Prices ({items.length})</h3>
                <p className="text-xs text-muted">Harga per satuan dasar. SKU yang tidak ada di sini memakai harga jual default.</p>
              </div>
              {items.length > 5 && (
                <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter SKU..." aria-label="Filter items" className={`${inputClass} w-56`} />
              )}
            </div>
            {editable && (
              <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-line-soft bg-subtle">
                <SkuPicker token={user.token} existing={existing} onAdd={addItems} searchFn={searchPriceListSkus} />
                <BulkAdd token={user.token} onLoad={addItems} />
                {items.length > 0 && (
                  <div className="flex items-center gap-2 ml-auto">
                    <span className="text-sm text-muted">Default −</span>
                    <input type="number" min="0" max="100" step="0.01" value={pct} onChange={(e) => setPct(e.target.value)} aria-label="Discount percent" className={`${cellInput} w-20 text-right`} />
                    <span className="text-sm text-muted">%</span>
                    <button type="button" onClick={applyPct} className={btnGhost}>Apply to all</button>
                  </div>
                )}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: 760 }}>
                <thead className="bg-head text-head-fg text-left">
                  <tr>
                    <th className="px-2 py-2 border-b border-line font-semibold w-10 text-right">#</th>
                    <th className="px-2 py-2 border-b border-line font-semibold">SKU</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-32 text-right">Default price</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-36 text-right">List price</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-24 text-right">vs default</th>
                    {canSeeCost && <th className="px-2 py-2 border-b border-line font-semibold w-28 text-right" title="(harga - HPP) / harga">Margin</th>}
                    {editable && <th className="px-2 py-2 border-b border-line w-10"></th>}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((i, index) => {
                    const p = Number(i.price);
                    const diff = hasValue(i.defaultPrice) && i.defaultPrice > 0 && hasValue(i.price) ? round2(((p - i.defaultPrice) / i.defaultPrice) * 100) : null;
                    const margin = canSeeCost && hasValue(i.avgCost) && p > 0 ? round2(((p - i.avgCost) / p) * 100) : null;
                    return (
                      <tr key={i.sku._id || index} className="hover:bg-subtle">
                        <td className="px-2 py-1.5 border-t border-line-soft text-right text-muted tabular-nums">{index + 1}</td>
                        <td className="px-2 py-1.5 border-t border-line-soft">
                          <div className="font-mono text-xs font-semibold text-fg">{i.sku.sku}</div>
                          <div className="text-xs text-muted truncate max-w-72">{i.sku.produkName} · {i.sku.variant}</div>
                        </td>
                        <td className="px-2 py-1.5 border-t border-line-soft text-right tabular-nums text-muted">{hasValue(i.defaultPrice) ? formatRupiah(i.defaultPrice) : '-'}</td>
                        <td className="px-2 py-1.5 border-t border-line-soft text-right">
                          {editable ? (
                            <input aria-label={`Price ${i.sku.sku}`} type="number" min="0" step="0.01" value={i.price} disabled={busy}
                              onChange={(e) => setPrice(i.sku._id, e.target.value)} className={`${cellInput} text-right tabular-nums`} />
                          ) : <span className="tabular-nums">{formatRupiah(i.price)}</span>}
                        </td>
                        <td className={`px-2 py-1.5 border-t border-line-soft text-right tabular-nums ${diff < 0 ? 'text-danger' : 'text-muted'}`}>
                          {diff === null ? '-' : `${diff > 0 ? '+' : ''}${formatNumber(diff)}%`}
                        </td>
                        {canSeeCost && (
                          <td className={`px-2 py-1.5 border-t border-line-soft text-right tabular-nums ${margin !== null && margin < 0 ? 'text-danger' : ''}`}>
                            {margin === null ? '-' : `${formatNumber(margin)}%`}
                          </td>
                        )}
                        {editable && (
                          <td className="px-2 py-1.5 border-t border-line-soft text-center">
                            <button type="button" title="Remove" aria-label={`Remove ${i.sku.sku}`} onClick={() => removeItem(i.sku._id)}
                              className="w-8 h-8 rounded-md text-muted hover:text-danger hover:bg-danger-soft cursor-pointer">
                              <i className="fa fa-xmark"></i>
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {shown.length === 0 && (
                    <tr><td colSpan={7} className="text-center py-8 text-muted">{items.length ? 'Tidak ada yang cocok.' : 'Belum ada harga.'}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {doc && (
          <aside className="space-y-4 min-w-0">
            <section className="rounded-lg border border-line bg-surface p-4 text-sm">
              <h3 className="font-semibold text-fg mb-2">Customers ({doc.customers.length})</h3>
              {doc.customers.length === 0 ? (
                <p className="text-xs text-muted">Belum dipakai. Tautkan di form Customer (field Price list).</p>
              ) : (
                <ul className="space-y-1">
                  {doc.customers.map((c) => (
                    <li key={c._id} className="flex items-center justify-between gap-2">
                      <span className="truncate">{c.name}</span>
                      <span className="font-mono text-xs text-muted">{c.code}</span>
                    </li>
                  ))}
                </ul>
              )}
              {customerPerm.canView && <Link to="/customer" className="inline-block mt-2 text-xs text-primary hover:underline">Kelola customer</Link>}
            </section>
            <AuditDetail data={doc} />
            <section className="rounded-lg border border-line bg-surface p-4">
              <h3 className="font-semibold text-fg mb-2">History</h3>
              <AuditTimeline entity="priceList" id={doc._id} refreshKey={version} />
            </section>
          </aside>
        )}
      </div>
    </div>
  );
}
