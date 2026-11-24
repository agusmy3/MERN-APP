import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getStockValuation } from '../services/stockService';
import { getGudangDropdown } from '../services/gudangService';
import { getKategoriDropdown } from '../services/kategoriService';
import { useAuth } from '../context/AuthContext';
import useToast from '../hooks/useToast';
import PageHeader from '../components/PageHeader';
import { inputClass } from '../utils/formStyles';
import { formatNumber, formatRupiah, variantLabel } from '../utils/formatHelper';

const GROUPS = [
  { key: 'sku', label: 'SKU', icon: 'fa-layer-group' },
  { key: 'produk', label: 'Product', icon: 'fa-box' },
  { key: 'kategori', label: 'Category', icon: 'fa-tags' },
  { key: 'gudang', label: 'Warehouse', icon: 'fa-warehouse' },
];
const selectClass = `${inputClass} sm:w-auto`;

// kolom per pengelompokan: { header, cell(row), csv(row), className }
const groupColumns = (groupBy) => {
  const money = { header: 'Value', className: 'text-right tabular-nums font-semibold', cell: (r) => formatRupiah(r.value), csv: (r) => r.value };
  const share = {
    header: 'Share',
    className: 'w-40',
    cell: (r) => (
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded bg-subtle overflow-hidden"><div className="h-full bg-primary" style={{ width: `${Math.min(r.share, 100)}%` }}></div></div>
        <span className="text-xs tabular-nums text-muted w-12 text-right">{formatNumber(r.share)}%</span>
      </div>
    ),
    csv: (r) => r.share,
  };
  const missing = {
    header: '',
    className: 'w-8 text-center',
    cell: (r) => (r.missingCost ? <i className="fa fa-triangle-exclamation text-warning-fg" title={`${r.missingCost} SKU berstok tanpa HPP (dihitung 0)`}></i> : ''),
    csv: (r) => (r.missingCost ? 'missing cost' : ''),
  };
  if (groupBy === 'sku') {
    return [
      {
        header: 'SKU',
        cell: (r) => (
          <>
            <Link to={`/produk/${r.produk._id}?tab=stock&sku=${r.sku._id}`} className="font-mono text-xs font-semibold hover:text-primary hover:underline">{r.sku.sku}</Link>
            {r.sku.isActive === false && <span className="ml-1.5 text-[10px] px-1 rounded bg-subtle text-muted">inactive</span>}
            <div className="text-xs text-muted truncate max-w-72">{r.produk.name} · {variantLabel(r.sku)}</div>
          </>
        ),
        csv: (r) => r.sku.sku,
      },
      { header: 'Product', cell: () => null, csv: (r) => r.produk.name, hidden: true },
      { header: 'Category', cell: (r) => r.kategori, csv: (r) => r.kategori },
      { header: 'Qty', className: 'text-right tabular-nums', cell: (r) => `${formatNumber(r.qty)} ${r.uom}`, csv: (r) => r.qty },
      { header: 'HPP', className: 'text-right tabular-nums', cell: (r) => (r.avgCost === null ? <span className="text-warning-fg">-</span> : formatRupiah(r.avgCost)), csv: (r) => r.avgCost ?? '' },
      money, share, missing,
    ];
  }
  if (groupBy === 'produk') {
    return [
      { header: 'Product', cell: (r) => <Link to={`/produk/${r.produk._id}?tab=stock`} className="hover:text-primary hover:underline">{r.produk.name}</Link>, csv: (r) => r.produk.name },
      { header: 'Category', cell: (r) => r.kategori, csv: (r) => r.kategori },
      { header: 'SKU', className: 'text-right tabular-nums', cell: (r) => r.skuCount, csv: (r) => r.skuCount },
      { header: 'Qty', className: 'text-right tabular-nums', cell: (r) => `${formatNumber(r.qty)} ${r.uom}`, csv: (r) => r.qty },
      money, share, missing,
    ];
  }
  if (groupBy === 'kategori') {
    return [
      { header: 'Category', cell: (r) => r.kategori.name, csv: (r) => r.kategori.name },
      { header: 'Products', className: 'text-right tabular-nums', cell: (r) => r.produkCount, csv: (r) => r.produkCount },
      { header: 'SKU', className: 'text-right tabular-nums', cell: (r) => r.skuCount, csv: (r) => r.skuCount },
      money, share, missing,
    ];
  }
  return [
    { header: 'Warehouse', cell: (r) => <><b>{r.gudang.code}</b> <span className="text-muted">— {r.gudang.name}</span></>, csv: (r) => `${r.gudang.code} - ${r.gudang.name}` },
    { header: 'Products', className: 'text-right tabular-nums', cell: (r) => r.produkCount, csv: (r) => r.produkCount },
    { header: 'SKU', className: 'text-right tabular-nums', cell: (r) => r.skuCount, csv: (r) => r.skuCount },
    money, share, missing,
  ];
};

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Stock Valuation: nilai persediaan SAAT INI (stok x HPP rata-rata), dikelompokkan per SKU / produk /
 * kategori / gudang. Izin vendorPrice:view (data biaya). Export CSV dari data yang tampil.
 */
export default function StockValuation() {
  const { user } = useAuth();
  const toast = useToast();
  const [groupBy, setGroupBy] = useState('sku');
  const [filters, setFilters] = useState({ gudang: '', kategori: '' });
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState({ gudangs: [], kategoris: [] });

  useEffect(() => {
    Promise.all([getGudangDropdown(user.token), getKategoriDropdown(user.token)])
      .then(([gudangs, kategoris]) => setOptions({ gudangs, kategoris }))
      .catch(console.error);
  }, [user.token]);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 500);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = { groupBy, search };
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    getStockValuation(user.token, params)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((err) => toast.error(err.response?.data?.message || 'Failed to load stock valuation'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.token, groupBy, filters, search]);

  const columns = useMemo(() => groupColumns(groupBy), [groupBy]);
  const visibleColumns = columns.filter((c) => !c.hidden);

  const exportCsv = () => {
    if (!data?.rows.length) return;
    const header = columns.filter((c) => c.header).map((c) => c.header);
    const lines = [header, ...data.rows.map((r) => columns.filter((c) => c.header).map((c) => c.csv(r)))];
    const csv = lines.map((l) => l.map(csvCell).join(',')).join('\n');
    const blob = new Blob([String.fromCharCode(0xfeff) + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock-valuation-${groupBy}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totals = data?.totals;

  return (
    <div className="h-full p-4 flex flex-col overflow-auto">
      <PageHeader
        fallbackTitle="Stock Valuation"
        actions={(
          <button type="button" onClick={exportCsv} disabled={!data?.rows.length}
            className="px-4 py-2 rounded border border-line hover:bg-subtle text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
            <i className="fa fa-file-csv"></i> Export CSV
          </button>
        )}
      />

      <div className="grid gap-3 sm:grid-cols-3 mb-4">
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="text-xs uppercase tracking-wider text-muted">Inventory value</div>
          <div className="text-2xl font-bold tabular-nums mt-1">{totals ? formatRupiah(totals.value) : '-'}</div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="text-xs uppercase tracking-wider text-muted">SKU in stock</div>
          <div className="text-2xl font-bold tabular-nums mt-1">{totals ? formatNumber(totals.skuCount) : '-'}</div>
        </div>
        <div className={`rounded-lg border p-4 ${totals?.missingCost ? 'border-warning-fg/40 bg-warning-soft' : 'border-line bg-surface'}`}>
          <div className="text-xs uppercase tracking-wider text-muted">SKU without HPP</div>
          <div className="text-2xl font-bold tabular-nums mt-1">{totals ? formatNumber(totals.missingCost) : '-'}</div>
          {totals?.missingCost > 0 && <div className="text-xs mt-1">Dihitung 0. Isi lewat Goods Receipt atau <code>npm run migrate:avg-cost</code>.</div>}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col p-4 bg-surface border border-line rounded-lg shadow-sm">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div role="tablist" aria-label="Group by" className="inline-flex rounded-md border border-line overflow-hidden">
            {GROUPS.map((g) => (
              <button key={g.key} type="button" role="tab" aria-selected={groupBy === g.key} onClick={() => setGroupBy(g.key)}
                className={`px-3 py-1.5 text-sm cursor-pointer ${groupBy === g.key ? 'bg-primary text-primary-fg' : 'hover:bg-subtle'}`}>
                <i className={`fa ${g.icon} mr-1.5 text-xs`}></i>{g.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-48 max-w-xs">
            <i className="fa fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm"></i>
            <input type="search" aria-label="Search SKU or product" placeholder="Search SKU / product..." value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)} className={`${inputClass} pl-9`} />
          </div>
          <select aria-label="Warehouse" value={filters.gudang} onChange={(e) => setFilters((f) => ({ ...f, gudang: e.target.value }))} className={selectClass}>
            <option value="">All warehouses</option>
            {options.gudangs.map((g) => <option key={g._id} value={g._id}>{g.code} — {g.name}</option>)}
          </select>
          <select aria-label="Category" value={filters.kategori} onChange={(e) => setFilters((f) => ({ ...f, kategori: e.target.value }))} className={selectClass}>
            <option value="">All categories</option>
            {options.kategoris.map((k) => <option key={k._id} value={k._id}>{k.name}</option>)}
          </select>
        </div>

        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: 760 }}>
            <thead className="bg-head text-head-fg text-left sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 border-b border-line font-semibold w-12 text-right">#</th>
                {visibleColumns.map((c) => <th key={c.header || 'flag'} className={`px-3 py-2 border-b border-line font-semibold ${c.className || ''}`}>{c.header}</th>)}
              </tr>
            </thead>
            <tbody className={loading ? 'opacity-50' : ''}>
              {data?.rows.map((r, i) => (
                <tr key={r.key} className="hover:bg-subtle">
                  <td className="px-3 py-1.5 border-t border-line-soft text-right text-muted tabular-nums">{i + 1}</td>
                  {visibleColumns.map((c) => <td key={c.header || 'flag'} className={`px-3 py-1.5 border-t border-line-soft ${c.className || ''}`}>{c.cell(r)}</td>)}
                </tr>
              ))}
              {data && !data.rows.length && (
                <tr><td colSpan={visibleColumns.length + 1} className="text-center py-8 text-muted">Tidak ada stok.</td></tr>
              )}
            </tbody>
            {data?.rows.length > 0 && (
              <tfoot>
                <tr className="font-semibold">
                  <td className="px-3 py-2 border-t border-line bg-subtle" colSpan={visibleColumns.findIndex((c) => c.header === 'Value') + 1}>Total</td>
                  <td className="px-3 py-2 border-t border-line bg-subtle text-right tabular-nums">{formatRupiah(totals.value)}</td>
                  <td className="px-3 py-2 border-t border-line bg-subtle" colSpan={2}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <p className="text-xs text-muted mt-3">
          Nilai = stok saat ini x HPP rata-rata per SKU (sama untuk semua gudang). Qty dijumlah hanya per SKU / produk (satuannya sama).
        </p>
      </div>
    </div>
  );
}
