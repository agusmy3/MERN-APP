import { Fragment, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { getSalesReport, getAgingReport, getBackorderReport, getDeliveryReport, getCustomerDropdown } from '../services/salesService';
import { getMyGudangDropdown } from '../services/gudangService';
import { useAuth } from '../context/AuthContext';
import useToast from '../hooks/useToast';
import PageHeader from '../components/PageHeader';
import { inputClass } from '../utils/formStyles';
import { formatNumber, formatRupiah } from '../utils/formatHelper';
import { formatDay, toDateInput } from '../utils/dateHelper';
import { downloadCsv } from '../utils/csvExport';
import { DELIVERY_METHODS } from '../utils/salesMeta';

const selectClass = `${inputClass} sm:w-auto`;
const GROUPS = { day: 'Day', month: 'Month', customer: 'Customer', produk: 'Product', sku: 'SKU', kategori: 'Category' };
const BUCKETS = [['current', 'Not due'], ['d1_30', '1–30'], ['d31_60', '31–60'], ['d61_90', '61–90'], ['d90', '> 90']];
const th = 'px-3 py-2 border-b border-line font-semibold';
const td = 'px-3 py-1.5 border-t border-line-soft';
const btnGhost = 'px-4 py-2 rounded border border-line hover:bg-subtle text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

const firstOfMonth = () => toDateInput(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
const TABS = ['sales', 'aging', 'backorder', 'delivery'];
const pct = (v) => (v === null || v === undefined ? '-' : `${formatNumber(v)}%`);

/** label kelompok: tanggal / bulan diformat, entity dengan link */
function GroupLabel({ groupBy, row }) {
  if (groupBy === 'day') return dayjs(row.key).format('DD MMM YYYY');
  if (groupBy === 'month') return dayjs(`${row.key}-01`).format('MMMM YYYY');
  if (groupBy === 'produk' && row.key) return <Link to={`/produk/${row.key}`} className="hover:text-primary hover:underline">{row.label}</Link>;
  if (groupBy === 'sku' && row.produk) {
    return (
      <>
        <Link to={`/produk/${row.produk}?tab=sku`} className="font-mono text-xs font-semibold hover:text-primary hover:underline">{row.label}</Link>
        {row.sub && <div className="text-xs text-muted">{row.sub}</div>}
      </>
    );
  }
  return <>{row.label}{row.sub && <span className="ml-1.5 text-xs text-muted">{row.sub}</span>}</>;
}

/** Tab penjualan bersih per kelompok */
function SalesTab({ token, gudangs, customers }) {
  const toast = useToast();
  const [q, setQ] = useState({ from: firstOfMonth(), to: toDateInput(), groupBy: 'day', gudang: '', customer: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = { tz: Intl.DateTimeFormat().resolvedOptions().timeZone };
    Object.entries(q).forEach(([k, v]) => { if (v) params[k] = v; });
    getSalesReport(token, params)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((err) => toast.error(err.response?.data?.message || 'Failed to load report'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, q]);

  const set = (k, v) => setQ((prev) => ({ ...prev, [k]: v }));
  const cost = !!data?.canSeeCost;
  const shownGroup = data?.groupBy || q.groupBy;
  const withQty = shownGroup === 'produk' || shownGroup === 'sku';

  const exportCsv = () => {
    const header = [GROUPS[shownGroup], ...(withQty ? ['Qty'] : []), 'Invoices', 'Sales', 'Returns', 'Net sales', ...(cost ? ['HPP', 'Gross profit', 'Margin %'] : [])];
    const body = data.rows.map((r) => [
      shownGroup === 'sku' ? `${r.label} ${r.sub || ''}` : r.label,
      ...(withQty ? [r.qty] : []),
      r.invoiceCount, r.sales, r.returns, r.net,
      ...(cost ? [r.cogs, r.grossProfit, r.margin ?? ''] : []),
    ]);
    downloadCsv(`sales-report-${shownGroup}-${q.from}_${q.to}.csv`, [header, ...body]);
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <input type="date" aria-label="From date" value={q.from} max={q.to || undefined} onChange={(e) => set('from', e.target.value)} className={selectClass} />
          <span className="text-muted text-sm">–</span>
          <input type="date" aria-label="To date" value={q.to} min={q.from || undefined} onChange={(e) => set('to', e.target.value)} className={selectClass} />
        </div>
        <select aria-label="Group by" value={q.groupBy} onChange={(e) => set('groupBy', e.target.value)} className={selectClass}>
          {Object.entries(GROUPS).map(([k, v]) => <option key={k} value={k}>By {v.toLowerCase()}</option>)}
        </select>
        <select aria-label="Warehouse" value={q.gudang} onChange={(e) => set('gudang', e.target.value)} className={selectClass}>
          <option value="">All warehouses</option>
          {gudangs.map((g) => <option key={g._id} value={g._id}>{g.code}</option>)}
        </select>
        <select aria-label="Customer" value={q.customer} onChange={(e) => set('customer', e.target.value)} className={selectClass}>
          <option value="">All customers</option>
          {customers.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
        </select>
        <button type="button" onClick={exportCsv} disabled={!data?.rows.length} className={`${btnGhost} ml-auto`}>
          <i className="fa fa-file-csv"></i> Export CSV
        </button>
      </div>

      {data && (
        <div className="mb-4 grid gap-3 grid-cols-2 lg:grid-cols-5">
          {[
            ['Sales', data.totals.sales],
            ['Returns', -data.totals.returns],
            ['Net sales', data.totals.net],
            ...(cost ? [['HPP', data.totals.cogs], ['Gross profit', data.totals.grossProfit]] : []),
          ].map(([label, v]) => (
            <div key={label} className="rounded-lg border border-line bg-surface p-3">
              <div className="text-xs text-muted">{label}</div>
              <div className={`text-lg font-semibold tabular-nums ${v < 0 ? 'text-danger' : ''}`}>{formatRupiah(v)}</div>
              {label === 'Net sales' && <div className="text-xs text-muted">{data.totals.invoiceCount} invoice · tanpa PPN</div>}
              {label === 'Net sales' && data.totals.shipping > 0 && (
                <div className="text-xs text-muted" title="Ongkir yang ditagih ke customer (tanpa PPN); tidak termasuk penjualan barang & laba kotor">
                  + ongkir ditagih {formatRupiah(data.totals.shipping)}
                </div>
              )}
              {label === 'Gross profit' && <div className="text-xs text-muted">Margin {pct(data.totals.margin)}</div>}
            </div>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: cost ? 980 : 720 }}>
          <thead className="bg-head text-head-fg text-left sticky top-0">
            <tr>
              <th className={th}>{GROUPS[shownGroup]}</th>
              {withQty && <th className={`${th} w-28 text-right`}>Qty</th>}
              <th className={`${th} w-24 text-right`}>Invoices</th>
              <th className={`${th} w-36 text-right`}>Sales</th>
              <th className={`${th} w-32 text-right`}>Returns</th>
              <th className={`${th} w-36 text-right`}>Net sales</th>
              {cost && (
                <>
                  <th className={`${th} w-36 text-right`}>HPP</th>
                  <th className={`${th} w-36 text-right`}>Gross profit</th>
                  <th className={`${th} w-24 text-right`}>Margin</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {loading && !data && <tr><td colSpan={9} className="text-center py-8 text-muted">Loading...</td></tr>}
            {data?.rows.length === 0 && <tr><td colSpan={9} className="text-center py-8 text-muted">Tidak ada penjualan pada periode ini.</td></tr>}
            {data?.rows.map((r) => (
              <tr key={r.key || 'none'} className="hover:bg-subtle">
                <td className={td}><GroupLabel groupBy={shownGroup} row={r} /></td>
                {withQty && <td className={`${td} text-right tabular-nums`}>{formatNumber(r.qty)} {r.uom}</td>}
                <td className={`${td} text-right tabular-nums text-muted`}>{r.invoiceCount}</td>
                <td className={`${td} text-right tabular-nums`}>{formatRupiah(r.sales)}</td>
                <td className={`${td} text-right tabular-nums ${r.returns ? 'text-danger' : 'text-muted'}`}>{r.returns ? `−${formatRupiah(r.returns)}` : '-'}</td>
                <td className={`${td} text-right tabular-nums font-semibold`}>{formatRupiah(r.net)}</td>
                {cost && (
                  <>
                    <td className={`${td} text-right tabular-nums text-muted`}>{formatRupiah(r.cogs)}</td>
                    <td className={`${td} text-right tabular-nums ${r.grossProfit < 0 ? 'text-danger' : ''}`}>{formatRupiah(r.grossProfit)}</td>
                    <td className={`${td} text-right tabular-nums text-muted`}>{pct(r.margin)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">
        Penjualan bersih = DPP (tanpa PPN, setelah diskon). Invoice menurut tanggal invoice; retur mengurangi pada tanggal retur.
      </p>
    </>
  );
}

/** Tab umur piutang (saat ini) */
function AgingTab({ token, gudangs }) {
  const toast = useToast();
  const [gudang, setGudang] = useState('');
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(() => new Set());

  useEffect(() => {
    getAgingReport(token, gudang ? { gudang } : {})
      .then(setData)
      .catch((err) => toast.error(err.response?.data?.message || 'Failed to load aging'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, gudang]);

  const toggle = (id) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const exportCsv = () => {
    const header = ['Customer', 'Code', ...BUCKETS.map(([, l]) => l), 'Total'];
    downloadCsv(`ar-aging-${toDateInput()}.csv`, [
      header,
      ...data.rows.map((r) => [r.customer.name, r.customer.code || '', ...BUCKETS.map(([k]) => r[k]), r.total]),
    ]);
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select aria-label="Warehouse" value={gudang} onChange={(e) => setGudang(e.target.value)} className={selectClass}>
          <option value="">All warehouses</option>
          {gudangs.map((g) => <option key={g._id} value={g._id}>{g.code}</option>)}
        </select>
        <span className="text-sm text-muted">Per hari ini; hari = lewat dari jatuh tempo.</span>
        <button type="button" onClick={exportCsv} disabled={!data?.rows.length} className={`${btnGhost} ml-auto`}>
          <i className="fa fa-file-csv"></i> Export CSV
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: 900 }}>
          <thead className="bg-head text-head-fg text-left sticky top-0">
            <tr>
              <th className={th}>Customer</th>
              {BUCKETS.map(([k, l]) => <th key={k} className={`${th} w-32 text-right`}>{l}</th>)}
              <th className={`${th} w-36 text-right`}>Total</th>
            </tr>
          </thead>
          <tbody>
            {!data && <tr><td colSpan={7} className="text-center py-8 text-muted">Loading...</td></tr>}
            {data?.rows.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-muted"><i className="fa fa-check mr-1 text-success-fg"></i>Tidak ada piutang terbuka.</td></tr>}
            {data?.rows.map((r) => (
              <Fragment key={r.customer._id}>
                <tr className="hover:bg-subtle cursor-pointer" onClick={() => toggle(r.customer._id)}>
                  <td className={td}>
                    <i className={`fa fa-chevron-${open.has(r.customer._id) ? 'down' : 'right'} text-xs text-muted mr-2`}></i>
                    {r.customer.name} <span className="text-xs text-muted">· {r.invoices.length} invoice</span>
                  </td>
                  {BUCKETS.map(([k]) => (
                    <td key={k} className={`${td} text-right tabular-nums ${r[k] && k !== 'current' ? 'text-danger' : r[k] ? '' : 'text-muted'}`}>
                      {r[k] ? formatRupiah(r[k]) : '-'}
                    </td>
                  ))}
                  <td className={`${td} text-right tabular-nums font-semibold`}>{formatRupiah(r.total)}</td>
                </tr>
                {open.has(r.customer._id) && r.invoices.map((inv) => (
                  <tr key={inv._id} className="bg-subtle/50 text-xs">
                    <td className={`${td} pl-9`}>
                      <Link to={`/sales-invoice/${inv._id}`} className="font-mono font-semibold text-primary hover:underline">{inv.no}</Link>
                      <span className="text-muted"> · {formatDay(inv.date)} · due {inv.dueDate ? formatDay(inv.dueDate) : '-'}{inv.daysOverdue > 0 ? ` (${inv.daysOverdue} hari)` : ''} · {inv.gudang}</span>
                    </td>
                    {BUCKETS.map(([k]) => (
                      <td key={k} className={`${td} text-right tabular-nums`}>{inv.bucket === k ? formatRupiah(inv.balance) : ''}</td>
                    ))}
                    <td className={`${td} text-right tabular-nums text-muted`}>of {formatRupiah(inv.total)}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
            {data?.rows.length > 0 && (
              <tr className="font-semibold">
                <td className={`${td} border-t-line`}>Total</td>
                {BUCKETS.map(([k]) => <td key={k} className={`${td} text-right tabular-nums`}>{formatRupiah(data.totals[k])}</td>)}
                <td className={`${td} text-right tabular-nums`}>{formatRupiah(data.totals.total)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Tab sisa pesanan (backorder): baris SO OPEN / PARTIAL yang belum terkirim */
function BackorderTab({ token, gudangs, customers }) {
  const toast = useToast();
  const [filters, setFilters] = useState({ gudang: '', customer: '', search: '', late: false });
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.search === search ? f : { ...f, search })), 400);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const params = {};
    if (filters.gudang) params.gudang = filters.gudang;
    if (filters.customer) params.customer = filters.customer;
    if (filters.search) params.search = filters.search;
    if (filters.late) params.late = 'true';
    getBackorderReport(token, params)
      .then(setData)
      .catch((err) => toast.error(err.response?.data?.message || 'Failed to load backorder'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, filters]);

  const exportCsv = () => {
    downloadCsv(`backorder-${toDateInput()}.csv`, [
      ['SO', 'Date', 'Requested', 'Customer', 'Customer PO', 'Warehouse', 'SKU', 'Product', 'Ordered', 'Delivered', 'Outstanding', 'UoM', 'Stock', 'Value', 'Late'],
      ...data.rows.map((r) => [r.so.no, formatDay(r.so.date), r.so.requestedDate ? formatDay(r.so.requestedDate) : '', r.customer?.name || '',
        r.so.customerPoNo || '', r.gudang?.code || '', r.sku?.sku || '', r.produk?.name || '', r.ordered, r.delivered, r.outstanding, r.uom, r.onHand, r.value, r.late ? 'yes' : '']),
    ]);
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input type="search" aria-label="Search backorder" placeholder="SO no., customer PO, customer..." value={search}
          onChange={(e) => setSearch(e.target.value)} className={`${inputClass} max-w-xs`} />
        <select aria-label="Warehouse" value={filters.gudang} onChange={(e) => setFilters((f) => ({ ...f, gudang: e.target.value }))} className={selectClass}>
          <option value="">All warehouses</option>
          {gudangs.map((g) => <option key={g._id} value={g._id}>{g.code}</option>)}
        </select>
        <select aria-label="Customer" value={filters.customer} onChange={(e) => setFilters((f) => ({ ...f, customer: e.target.value }))} className={selectClass}>
          <option value="">All customers</option>
          {customers.filter((c) => !c.isWalkIn).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={filters.late} onChange={(e) => setFilters((f) => ({ ...f, late: e.target.checked }))} className="w-4 h-4 accent-primary" />
          Late only
        </label>
        <button type="button" onClick={exportCsv} disabled={!data?.rows.length} className={`${btnGhost} ml-auto`}>
          <i className="fa fa-file-csv"></i> Export CSV
        </button>
      </div>
      {data && (
        <div className="mb-4 grid gap-3 grid-cols-2 lg:grid-cols-4">
          {[['Sales orders', formatNumber(data.totals.soCount)], ['Lines', formatNumber(data.totals.lineCount)],
            ['Outstanding value', formatRupiah(data.totals.value)], ['Late orders', formatNumber(data.totals.lateCount)]].map(([label, v]) => (
            <div key={label} className="rounded-lg border border-line bg-surface px-4 py-3">
              <div className="text-xs text-muted">{label}</div>
              <div className="text-lg font-semibold tabular-nums">{v}</div>
            </div>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: 1100 }}>
          <thead className="bg-head text-head-fg text-left sticky top-0">
            <tr>
              <th className={th}>Sales order</th>
              <th className={th}>Customer</th>
              <th className={`${th} w-20`}>Whs.</th>
              <th className={th}>SKU</th>
              <th className={`${th} w-24 text-right`}>Ordered</th>
              <th className={`${th} w-24 text-right`}>Delivered</th>
              <th className={`${th} w-28 text-right`}>Outstanding</th>
              <th className={`${th} w-24 text-right`} title="Stok gudang saat ini">Stock</th>
              <th className={`${th} w-32 text-right`} title="Sisa qty x harga bersih baris (sebelum diskon dokumen & PPN)">Value</th>
            </tr>
          </thead>
          <tbody>
            {!data && <tr><td colSpan={9} className="text-center py-8 text-muted">Loading...</td></tr>}
            {data?.rows.length === 0 && <tr><td colSpan={9} className="text-center py-8 text-muted"><i className="fa fa-check mr-1 text-success-fg"></i>Tidak ada sisa pesanan.</td></tr>}
            {data?.rows.map((r) => (
              <tr key={`${r.so._id}:${r.sku?._id}`} className="hover:bg-subtle">
                <td className={td}>
                  <Link to={`/sales-order/${r.so._id}`} className="font-mono text-xs font-semibold text-primary hover:underline">{r.so.no}</Link>
                  <div className={`text-xs ${r.late ? 'text-danger' : 'text-muted'}`}>
                    {formatDay(r.so.date)}{r.so.requestedDate ? ` · minta ${formatDay(r.so.requestedDate)}` : ''}{r.late ? ' · late' : ''}
                  </div>
                </td>
                <td className={td}>{r.customer?.name}{r.so.customerPoNo && <div className="text-xs text-muted">PO {r.so.customerPoNo}</div>}</td>
                <td className={td}>{r.gudang?.code}</td>
                <td className={td}>
                  <span className="font-mono text-xs font-semibold">{r.sku?.sku}</span>
                  <div className="text-xs text-muted truncate max-w-56">{r.produk?.name}</div>
                </td>
                <td className={`${td} text-right tabular-nums text-muted`}>{formatNumber(r.ordered)}</td>
                <td className={`${td} text-right tabular-nums text-muted`}>{formatNumber(r.delivered)}</td>
                <td className={`${td} text-right tabular-nums font-semibold`}>{formatNumber(r.outstanding)} {r.uom}</td>
                <td className={`${td} text-right tabular-nums ${r.onHand < r.outstanding ? 'text-danger' : ''}`}>{formatNumber(r.onHand)}</td>
                <td className={`${td} text-right tabular-nums`}>{formatRupiah(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data?.truncated && <p className="mt-2 text-xs text-muted">Hanya 1.000 SO pertama yang ditampilkan; persempit filter.</p>}
    </>
  );
}

/** Tab pengiriman: surat jalan POSTED per periode */
function DeliveryTab({ token, gudangs, customers }) {
  const toast = useToast();
  const [filters, setFilters] = useState({ from: firstOfMonth(), to: toDateInput(), gudang: '', customer: '', method: '', invoiced: '' });
  const [data, setData] = useState(null);
  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
    getDeliveryReport(token, params)
      .then(setData)
      .catch((err) => toast.error(err.response?.data?.message || 'Failed to load deliveries'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, filters]);

  const exportCsv = () => {
    downloadCsv(`deliveries-${filters.from}-${filters.to}.csv`, [
      ['DO', 'Date', 'SO', 'Customer', 'Warehouse', 'Method', 'Vehicle / Courier', 'Tracking', 'Lines', 'Qty', 'Value', 'Invoice'],
      ...data.rows.map((r) => [r.no, formatDay(r.date), r.salesOrder?.no || '', r.customer?.name || '', r.gudang?.code || '',
        DELIVERY_METHODS[r.deliveryMethod]?.label || r.deliveryMethod, [r.vehicleNo, r.courier, r.pickedUpBy].filter(Boolean).join(' / '),
        r.trackingNo || '', r.lineCount, r.qty, r.value, r.invoice?.no || '']),
    ]);
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <input type="date" aria-label="From date" value={filters.from} max={filters.to} onChange={(e) => set('from', e.target.value)} className={selectClass} />
          <span className="text-muted text-sm">–</span>
          <input type="date" aria-label="To date" value={filters.to} min={filters.from} onChange={(e) => set('to', e.target.value)} className={selectClass} />
        </div>
        <select aria-label="Warehouse" value={filters.gudang} onChange={(e) => set('gudang', e.target.value)} className={selectClass}>
          <option value="">All warehouses</option>
          {gudangs.map((g) => <option key={g._id} value={g._id}>{g.code}</option>)}
        </select>
        <select aria-label="Customer" value={filters.customer} onChange={(e) => set('customer', e.target.value)} className={selectClass}>
          <option value="">All customers</option>
          {customers.filter((c) => !c.isWalkIn).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
        </select>
        <select aria-label="Method" value={filters.method} onChange={(e) => set('method', e.target.value)} className={selectClass}>
          <option value="">All methods</option>
          {Object.entries(DELIVERY_METHODS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
        </select>
        <select aria-label="Invoice status" value={filters.invoiced} onChange={(e) => set('invoiced', e.target.value)} className={selectClass}>
          <option value="">All invoices</option>
          <option value="false">Belum ditagih</option>
          <option value="true">Sudah ditagih</option>
        </select>
        <button type="button" onClick={exportCsv} disabled={!data?.rows.length} className={`${btnGhost} ml-auto`}>
          <i className="fa fa-file-csv"></i> Export CSV
        </button>
      </div>
      {data && (
        <div className="mb-4 grid gap-3 grid-cols-2 lg:grid-cols-4">
          {[['Delivery orders', `${formatNumber(data.totals.count)}`, `${data.totals.delivery} dikirim · ${data.totals.pickup} diambil`],
            ['Quantity', formatNumber(data.totals.qty), null],
            ['Value', formatRupiah(data.totals.value), 'harga SO sebelum diskon dokumen & PPN'],
            ['Not invoiced', formatRupiah(data.totals.uninvoicedValue), `${data.totals.uninvoicedCount} surat jalan`]].map(([label, v, sub]) => (
            <div key={label} className="rounded-lg border border-line bg-surface px-4 py-3">
              <div className="text-xs text-muted">{label}</div>
              <div className="text-lg font-semibold tabular-nums">{v}</div>
              {sub && <div className="text-xs text-muted">{sub}</div>}
            </div>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: 1100 }}>
          <thead className="bg-head text-head-fg text-left sticky top-0">
            <tr>
              <th className={th}>Delivery order</th>
              <th className={th}>Customer</th>
              <th className={`${th} w-20`}>Whs.</th>
              <th className={th}>Method</th>
              <th className={th}>Vehicle / Courier</th>
              <th className={`${th} w-20 text-right`}>Lines</th>
              <th className={`${th} w-24 text-right`}>Qty</th>
              <th className={`${th} w-32 text-right`}>Value</th>
              <th className={`${th} w-36`}>Invoice</th>
            </tr>
          </thead>
          <tbody>
            {!data && <tr><td colSpan={9} className="text-center py-8 text-muted">Loading...</td></tr>}
            {data?.rows.length === 0 && <tr><td colSpan={9} className="text-center py-8 text-muted">Tidak ada surat jalan pada periode ini.</td></tr>}
            {data?.rows.map((r) => (
              <tr key={r._id} className="hover:bg-subtle">
                <td className={td}>
                  <Link to={`/delivery-order/${r._id}`} className="font-mono text-xs font-semibold text-primary hover:underline">{r.no}</Link>
                  <div className="text-xs text-muted">{formatDay(r.date)}{r.salesOrder ? ` · ${r.salesOrder.no}` : ''}</div>
                </td>
                <td className={td}>{r.customer?.name}</td>
                <td className={td}>{r.gudang?.code}</td>
                <td className={td}>
                  <i className={`fa ${DELIVERY_METHODS[r.deliveryMethod]?.icon || 'fa-truck'} text-muted mr-1.5`}></i>{DELIVERY_METHODS[r.deliveryMethod]?.label}
                </td>
                <td className={td}>
                  {[r.vehicleNo, r.driverName, r.courier, r.pickedUpBy].filter(Boolean).join(' · ') || '-'}
                  {r.trackingNo && <div className="text-xs text-muted">Resi {r.trackingNo}</div>}
                </td>
                <td className={`${td} text-right tabular-nums text-muted`}>{r.lineCount}</td>
                <td className={`${td} text-right tabular-nums`}>{formatNumber(r.qty)}</td>
                <td className={`${td} text-right tabular-nums`}>{formatRupiah(r.value)}</td>
                <td className={td}>
                  {r.invoice
                    ? <Link to={`/sales-invoice/${r.invoice._id}`} className="font-mono text-xs text-primary hover:underline">{r.invoice.no}</Link>
                    : <span className="text-xs px-1.5 py-0.5 rounded bg-warning-soft text-warning-fg">Belum ditagih</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data?.truncated && <p className="mt-2 text-xs text-muted">Hanya 2.000 surat jalan terbaru yang ditampilkan; persempit periode.</p>}
    </>
  );
}

/** Sales Report: /sales-report?tab=sales|aging|backorder|delivery */
export default function SalesReport() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = TABS.includes(searchParams.get('tab')) ? searchParams.get('tab') : 'sales';
  const [gudangs, setGudangs] = useState([]);
  const [customers, setCustomers] = useState([]);

  useEffect(() => {
    getMyGudangDropdown(user.token).then(setGudangs).catch(console.error);
    getCustomerDropdown(user.token).then(setCustomers).catch(console.error);
  }, [user.token]);

  const tabBtn = (key, label, icon) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === key}
      onClick={() => setSearchParams(key === 'sales' ? {} : { tab: key }, { replace: true })}
      className={`px-4 py-2 text-sm border-b-2 cursor-pointer ${tab === key ? 'border-primary text-primary font-medium' : 'border-transparent text-muted hover:text-fg'}`}
    >
      <i className={`fa ${icon} mr-1.5`}></i>{label}
    </button>
  );

  return (
    <div className="h-full p-4 flex flex-col">
      <PageHeader fallbackTitle="Sales Report" />
      <div role="tablist" className="mb-4 flex gap-1 border-b border-line">
        {tabBtn('sales', 'Sales', 'fa-chart-column')}
        {tabBtn('aging', 'Receivable aging', 'fa-hourglass-half')}
        {tabBtn('backorder', 'Backorder', 'fa-boxes-stacked')}
        {tabBtn('delivery', 'Deliveries', 'fa-truck-fast')}
      </div>
      <div className="min-h-0 flex-1 flex flex-col">
        {tab === 'sales' && <SalesTab token={user.token} gudangs={gudangs} customers={customers} />}
        {tab === 'aging' && <AgingTab token={user.token} gudangs={gudangs} />}
        {tab === 'backorder' && <BackorderTab token={user.token} gudangs={gudangs} customers={customers} />}
        {tab === 'delivery' && <DeliveryTab token={user.token} gudangs={gudangs} customers={customers} />}
      </div>
    </div>
  );
}
