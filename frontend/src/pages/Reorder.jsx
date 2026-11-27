import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getReorderAlerts, createPoFromReorder } from '../services/stockService';
import { getMyGudangDropdown } from '../services/gudangService';
import { getKategoriDropdown } from '../services/kategoriService';
import { getVendorDropdown } from '../services/vendorService';
import { getUomDropdown } from '../services/uomService';
import { useAuth } from '../context/AuthContext';
import usePermission from '../hooks/usePermission';
import useToast from '../hooks/useToast';
import useConfirm from '../hooks/useConfirm';
import PageHeader from '../components/PageHeader';
import StatusBadge from '../components/stock/StatusBadge';
import { inputClass } from '../utils/formStyles';
import { formatNumber, formatRupiah, variantLabel } from '../utils/formatHelper';
import { REORDER_STATUS } from '../utils/reorderMeta';

import FilterBar from '../components/FilterBar';
const selectClass = `${inputClass} sm:w-auto`;
const cellInput = `w-full bg-input text-fg border border-line rounded px-2 py-1 text-sm
  focus:outline-none focus:border-primary`;
const keyOf = (r) => `${r.sku._id}:${r.gudang._id}`;

// rencana pesan per baris (bisa diubah sebelum Create PO): vendor, satuan beli, qty, harga.
// Satuan beli = daftar harga vendor tsb atau satuan dasar; konversi mengikuti pilihan (tidak diketik).
const uomChoicesOf = (r, vendor) => {
  const list = (r.priceOptions || [])
    .filter((o) => String(o.vendor) === String(vendor))
    .map((o) => ({ _id: o.uomBeli?._id, code: o.uomBeli?.code, konversi: o.konversi, option: o }));
  if (r.uomId && !list.some((u) => u._id === r.uomId)) list.push({ _id: r.uomId, code: r.uom, konversi: 1, option: null });
  return list.filter((u) => u._id);
};
const planOf = (r) => (r.suggestion ? {
  vendor: r.suggestion.vendor?._id || '',
  uomBeli: r.suggestion.uomBeli?._id || '',
  konversi: r.suggestion.konversi,
  qty: r.suggestion.qty || '',
  hargaBeli: r.suggestion.hargaBeli ?? '',
} : {
  vendor: '', uomBeli: r.uomId || '', konversi: 1, qty: r.suggestedQty || '', hargaBeli: '',
});

/**
 * Reorder: SKU yang stoknya <= minimum per gudang (rule diatur di tab Stock detail produk).
 * Pilih baris -> Create PO = draft PO per vendor + gudang (perlu izin purchaseOrder:create).
 */
export default function Reorder() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const poPerm = usePermission('purchaseOrder');
  const [filters, setFilters] = useState({ status: '', gudang: '', kategori: '' });
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [plans, setPlans] = useState({});
  const [selected, setSelected] = useState(() => new Set());
  const [options, setOptions] = useState({ gudangs: [], kategoris: [], vendors: [], uoms: [] });
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState([]);

  useEffect(() => {
    Promise.all([getMyGudangDropdown(user.token), getKategoriDropdown(user.token), getVendorDropdown(user.token), getUomDropdown(user.token)])
      .then(([gudangs, kategoris, vendors, uoms]) => setOptions({ gudangs, kategoris, vendors, uoms }))
      .catch(console.error);
  }, [user.token]);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { search };
      Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
      const data = await getReorderAlerts(user.token, params);
      setRows(data);
      setPlans(Object.fromEntries(data.map((r) => [keyOf(r), planOf(r)])));
      // pilih otomatis yang perlu dipesan & punya vendor
      setSelected(new Set(data.filter((r) => ['OUT', 'CRITICAL'].includes(r.status) && r.suggestion?.qty > 0).map(keyOf)));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load reorder alerts');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.token, filters, search]);

  useEffect(() => { load(); }, [load]);

  const setPlan = (key, patch) => setPlans((p) => ({ ...p, [key]: { ...p[key], ...patch } }));
  // ganti vendor: pakai satuan dari daftar harga vendor tsb (utama dulu), jika tidak ada -> satuan dasar
  const changeVendor = (r, vendor) => {
    const choices = uomChoicesOf(r, vendor).sort((a, b) => Number(!!b.option?.isPreferred) - Number(!!a.option?.isPreferred));
    const c = choices[0];
    setPlan(keyOf(r), {
      vendor,
      uomBeli: c?._id || '',
      konversi: c?.konversi ?? 1,
      hargaBeli: c?.option?.hargaBeli ?? '',
      ...(c && r.suggestedQty > 0 ? { qty: Math.max(Math.ceil(r.suggestedQty / c.konversi), c.option?.minOrder || 0) } : {}),
    });
  };
  const changeUom = (r, uomId) => {
    const p = plans[keyOf(r)] || {};
    const c = uomChoicesOf(r, p.vendor).find((u) => u._id === uomId);
    if (!c) return;
    setPlan(keyOf(r), {
      uomBeli: uomId,
      konversi: c.konversi,
      ...(c.option?.hargaBeli !== undefined ? { hargaBeli: c.option.hargaBeli } : {}),
      ...(r.suggestedQty > 0 ? { qty: Math.max(Math.ceil(r.suggestedQty / c.konversi), c.option?.minOrder || 0) } : {}),
    });
  };
  const toggle = (key, checked) => setSelected((prev) => {
    const next = new Set(prev);
    if (checked) next.add(key); else next.delete(key);
    return next;
  });

  const counts = useMemo(() => rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {}), [rows]);
  const selectedRows = rows.filter((r) => selected.has(keyOf(r)));
  const estTotal = selectedRows.reduce((s, r) => s + (Number(plans[keyOf(r)]?.qty) || 0) * (Number(plans[keyOf(r)]?.hargaBeli) || 0), 0);

  const createPo = async () => {
    const items = selectedRows.map((r) => ({ sku: r.sku._id, gudang: r.gudang._id, ...plans[keyOf(r)] }));
    const bad = selectedRows.find((r) => {
      const p = plans[keyOf(r)];
      return !p.vendor || !p.uomBeli || !(Number(p.qty) > 0) || p.hargaBeli === ''
        || !uomChoicesOf(r, p.vendor).some((u) => u._id === p.uomBeli);
    });
    if (bad) return toast.warning(`${bad.sku.sku}: lengkapi vendor, satuan (dari daftar harga vendor atau satuan dasar), qty, dan harga.`);
    const groups = new Set(items.map((i) => `${i.vendor}:${i.gudang}`)).size;
    const ok = await confirm({
      title: 'Create purchase orders?',
      message: `${items.length} item akan dibuat menjadi ${groups} draft PO (1 per vendor + gudang). Periksa & terbitkan PO-nya di menu Purchase Order.`,
      confirmLabel: `Create ${groups} draft PO`,
    });
    if (!ok) return;
    setCreating(true);
    try {
      const res = await createPoFromReorder(items, user.token);
      toast.success(res.data.message);
      setCreated(res.data.data);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create purchase orders');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="h-full p-4 flex flex-col overflow-auto">
      <PageHeader
        fallbackTitle="Reorder"
        actions={poPerm.canCreate && (
          <button type="button" onClick={createPo} disabled={!selectedRows.length || creating}
            className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
            <i className="fa fa-file-invoice"></i> {creating ? 'Creating...' : `Create PO (${selectedRows.length})`}
          </button>
        )}
      />

      {created.length > 0 && (
        <div className="mb-4 rounded-lg border border-line bg-success-soft p-3 text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
          <span><i className="fa fa-check mr-1"></i>Draft PO dibuat:</span>
          {created.map((p) => (
            <Link key={p._id} to={`/purchase-order/${p._id}`} className="font-mono font-semibold text-primary hover:underline">{p.no}</Link>
          ))}
          <button type="button" onClick={() => setCreated([])} className="ml-auto text-muted hover:text-fg cursor-pointer" aria-label="Dismiss">
            <i className="fa fa-xmark"></i>
          </button>
        </div>
      )}

      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 mb-4">
        {['OUT', 'CRITICAL', 'ORDERED'].map((s) => (
          <button key={s} type="button" onClick={() => setFilters((f) => ({ ...f, status: f.status === s ? '' : s }))}
            className={`text-left rounded-lg border p-3 cursor-pointer ${filters.status === s ? 'border-primary bg-primary-soft' : 'border-line bg-surface hover:bg-subtle'}`}>
            <div className="text-xs uppercase tracking-wider text-muted"><i className={`fa ${REORDER_STATUS[s].icon} mr-1`}></i>{REORDER_STATUS[s].label}</div>
            <div className="text-2xl font-bold tabular-nums">{filters.status && filters.status !== s ? '–' : counts[s] || 0}</div>
          </button>
        ))}
        <div className="rounded-lg border border-line bg-surface p-3">
          <div className="text-xs uppercase tracking-wider text-muted">Selected value (est.)</div>
          <div className="text-lg font-bold tabular-nums">{formatRupiah(estTotal)}</div>
        </div>
      </div>

      <div className="flex flex-col lg:min-h-0 lg:flex-1 p-4 bg-surface border border-line rounded-lg shadow-sm">
        <FilterBar>
          <div className="relative flex-1 min-w-48 max-w-xs">
            <i className="fa fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm"></i>
            <input type="search" aria-label="Search SKU or product" placeholder="Search SKU / product..." value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)} className={`${inputClass} pl-9`} />
          </div>
          <select aria-label="Status" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className={selectClass}>
            <option value="">Need attention</option>
            {Object.entries(REORDER_STATUS).filter(([k]) => k !== 'OK').map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            <option value="ALL">All monitored</option>
          </select>
          <select aria-label="Warehouse" value={filters.gudang} onChange={(e) => setFilters((f) => ({ ...f, gudang: e.target.value }))} className={selectClass}>
            <option value="">All warehouses</option>
            {options.gudangs.map((g) => <option key={g._id} value={g._id}>{g.code} — {g.name}</option>)}
          </select>
          <select aria-label="Category" value={filters.kategori} onChange={(e) => setFilters((f) => ({ ...f, kategori: e.target.value }))} className={selectClass}>
            <option value="">All categories</option>
            {options.kategoris.map((k) => <option key={k._id} value={k._id}>{k.name}</option>)}
          </select>
        </FilterBar>

        <div className="overflow-auto max-h-[70vh] lg:max-h-none lg:min-h-0 lg:flex-1">
          <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: poPerm.canCreate ? 1380 : 1000 }}>
            <thead className="bg-head text-head-fg text-left sticky top-0 z-10">
              <tr>
                {poPerm.canCreate && <th className="px-2 py-2 border-b border-line w-9"></th>}
                <th className="px-2 py-2 border-b border-line font-semibold">SKU</th>
                <th className="px-2 py-2 border-b border-line font-semibold w-20">Whs.</th>
                <th className="px-2 py-2 border-b border-line font-semibold w-24 text-right">Stock</th>
                <th className="px-2 py-2 border-b border-line font-semibold w-24 text-right" title="Sisa Sales Order (OPEN / PARTIAL) yang belum dikirim dari gudang ini">Reserved</th>
                <th className="px-2 py-2 border-b border-line font-semibold w-28 text-right">Min / Max</th>
                <th className="px-2 py-2 border-b border-line font-semibold w-24 text-right">On order</th>
                <th className="px-2 py-2 border-b border-line font-semibold w-32">Status</th>
                <th className="px-2 py-2 border-b border-line font-semibold w-24 text-right" title="Saran dalam satuan dasar = max − (stok − dipesan customer + sedang dipesan)">Need</th>
                {poPerm.canCreate && (
                  <>
                    <th className="px-2 py-2 border-b border-line font-semibold w-48">Vendor</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-24">UoM</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-20 text-right">Conv.</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-24 text-right">Qty</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-32 text-right">Price</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className={loading ? 'opacity-50' : ''}>
              {rows.map((r) => {
                const key = keyOf(r);
                const p = plans[key] || {};
                return (
                  <tr key={key} className={selected.has(key) ? 'bg-highlight' : 'hover:bg-subtle'}>
                    {poPerm.canCreate && (
                      <td className="px-2 py-1.5 border-t border-line-soft text-center">
                        <input type="checkbox" aria-label={`Select ${r.sku.sku}`} checked={selected.has(key)}
                          onChange={(e) => toggle(key, e.target.checked)} className="w-4 h-4 accent-primary cursor-pointer" />
                      </td>
                    )}
                    <td className="px-2 py-1.5 border-t border-line-soft">
                      <Link to={`/produk/${r.produk._id}?tab=stock&sku=${r.sku._id}&gudang=${r.gudang._id}`} className="font-mono text-xs font-semibold hover:text-primary hover:underline">{r.sku.sku}</Link>
                      <div className="text-xs text-muted truncate max-w-64">{r.produk.name} · {variantLabel(r.sku)}</div>
                    </td>
                    <td className="px-2 py-1.5 border-t border-line-soft">{r.gudang.code}</td>
                    <td className={`px-2 py-1.5 border-t border-line-soft text-right tabular-nums font-semibold ${r.onHand <= 0 ? 'text-danger' : ''}`}>{formatNumber(r.onHand)} {r.uom}</td>
                    <td className="px-2 py-1.5 border-t border-line-soft text-right tabular-nums" title={r.committed ? `Tersedia ${formatNumber(r.available)}` : undefined}>
                      {r.committed ? <span className={r.available <= r.minQty ? 'text-danger' : ''}>{formatNumber(r.committed)}</span> : <span className="text-muted">-</span>}
                    </td>
                    <td className="px-2 py-1.5 border-t border-line-soft text-right tabular-nums text-muted">{formatNumber(r.minQty)} / {formatNumber(r.maxQty)}</td>
                    <td className="px-2 py-1.5 border-t border-line-soft text-right tabular-nums">{r.onOrder ? formatNumber(r.onOrder) : '-'}</td>
                    <td className="px-2 py-1.5 border-t border-line-soft"><StatusBadge status={r.status} meta={REORDER_STATUS} /></td>
                    <td className="px-2 py-1.5 border-t border-line-soft text-right tabular-nums">{r.suggestedQty ? formatNumber(r.suggestedQty) : '-'}</td>
                    {poPerm.canCreate && (
                      <>
                        <td className="px-2 py-1.5 border-t border-line-soft">
                          <select aria-label={`Vendor ${r.sku.sku}`} value={p.vendor} onChange={(e) => changeVendor(r, e.target.value)} className={`${cellInput} px-1`}>
                            <option value="">— vendor —</option>
                            {options.vendors.map((v) => <option key={v._id} value={v._id}>{v.companyName}</option>)}
                          </select>
                          {r.suggestion?.isPreferred && <div className="text-[10px] text-muted mt-0.5">vendor utama</div>}
                        </td>
                        <td className="px-2 py-1.5 border-t border-line-soft">
                          <select aria-label={`UoM ${r.sku.sku}`} value={p.uomBeli} disabled={!p.vendor} onChange={(e) => changeUom(r, e.target.value)} className={`${cellInput} px-1`}>
                            {!p.vendor && <option value="">—</option>}
                            {uomChoicesOf(r, p.vendor).map((u) => <option key={u._id} value={u._id}>{u.code}{u.option ? ' ★' : ''}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1.5 border-t border-line-soft">
                          <div className="px-2 py-1 text-right tabular-nums" title="Dari daftar harga vendor (satuan dasar = 1)">{p.vendor ? formatNumber(p.konversi) : '-'}</div>
                        </td>
                        <td className="px-2 py-1.5 border-t border-line-soft">
                          <input aria-label={`Qty ${r.sku.sku}`} type="number" min="0.01" step="0.01" value={p.qty}
                            onChange={(e) => setPlan(key, { qty: e.target.value })} className={`${cellInput} text-right tabular-nums`} />
                        </td>
                        <td className="px-2 py-1.5 border-t border-line-soft">
                          <input aria-label={`Price ${r.sku.sku}`} type="number" min="0" step="0.01" value={p.hargaBeli}
                            onChange={(e) => setPlan(key, { hargaBeli: e.target.value })} className={`${cellInput} text-right tabular-nums`} />
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={14} className="text-center py-8 text-muted">
                  Tidak ada SKU yang perlu perhatian. Atur batas min/max di tab <b>Stock</b> detail produk.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted mt-3">
          Need = max − (stok + sedang dipesan dari PO terbuka). Qty dalam satuan beli; saran dari vendor utama dibulatkan ke atas & min. order.
          PO yang dibuat berstatus draft per vendor + gudang.
        </p>
      </div>
    </div>
  );
}
