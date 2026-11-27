import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getShifts, getShift, forceCloseShift, getOutletDropdown, getCashierReport } from '../services/posService';
import { printShiftReport } from '../utils/receiptPrint';
import { downloadCsv } from '../utils/csvExport';
import { toDateInput } from '../utils/dateHelper';
import { useAuth } from '../context/AuthContext';
import usePermission from '../hooks/usePermission';
import useToast from '../hooks/useToast';
import useDataTable from '../hooks/useDataTable';
import PageHeader from '../components/PageHeader';
import DataTable from '../components/DataTable';
import Pagination from '../components/Pagination';
import SideDrawer from '../components/SideDrawer';
import { inputClass } from '../utils/formStyles';
import { formatRupiah } from '../utils/formatHelper';
import { formatDate2 } from '../utils/dateHelper';
import { PAYMENT_METHODS } from '../utils/salesMeta';

import FilterBar from '../components/FilterBar';
const EMPTY_FILTERS = { status: '', outlet: '', from: '', to: '' };
const selectClass = `${inputClass} sm:w-auto`;

const diffCell = (d) => (d === null || d === undefined ? '-'
  : <span className={d === 0 ? 'text-success-fg' : 'text-danger font-semibold'}>{d > 0 ? '+' : d < 0 ? '−' : ''}{formatRupiah(Math.abs(d))}</span>);

/** Detail shift: ringkasan kas, pembayaran per metode, kas masuk/keluar, transaksi; tutup paksa */
function ShiftDetail({ id, token, onClose, onChanged }) {
  const perm = usePermission('posShift');
  const invPerm = usePermission('salesInvoice');
  const toast = useToast();
  const [s, setS] = useState(null);
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getShift(id, token).then(setS).catch((err) => toast.error(err.response?.data?.message || 'Failed to load shift'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);
  useEffect(() => { load(); }, [load]);

  const close = async () => {
    if (counted === '') return toast.warning('Isi uang fisik di laci.');
    setBusy(true);
    try {
      const res = await forceCloseShift(id, { closingCash: Number(counted), note }, token);
      toast.success(res.data.message);
      load();
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to close shift');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SideDrawer open title={s ? `Shift ${s.no}` : 'Shift'} subtitle={s ? `${s.outlet?.name} · ${s.cashier?.name}` : ''} onClose={onClose}>
      {!s ? <p className="text-muted">Loading...</p> : (
        <div className="space-y-5 text-sm">
          <dl className="grid grid-cols-2 gap-y-1">
            <dt className="text-muted">Status</dt><dd className="text-right font-semibold">{s.status}</dd>
            <dt className="text-muted">Dibuka</dt><dd className="text-right">{formatDate2(s.openedAt)}</dd>
            {s.closedAt && <><dt className="text-muted">Ditutup</dt><dd className="text-right">{formatDate2(s.closedAt)}</dd></>}
            <dt className="text-muted">Transaksi</dt><dd className="text-right tabular-nums">{s.summary.salesCount}</dd>
            <dt className="text-muted">Total penjualan</dt><dd className="text-right tabular-nums">{formatRupiah(s.summary.salesTotal)}</dd>
            <dt className="text-muted">Void</dt><dd className="text-right tabular-nums">{s.summary.voidCount} · {formatRupiah(s.summary.voidTotal)}</dd>
            <dt className="text-muted">Retur</dt><dd className="text-right tabular-nums">{s.summary.returnCount} · {formatRupiah(s.summary.returnTotal)}</dd>
          </dl>
          <button type="button" onClick={() => printShiftReport(s, s.summary)}
            className="px-3 py-1.5 rounded text-sm border border-line hover:bg-subtle cursor-pointer">
            <i className="fa fa-print"></i> Cetak laporan {s.status === 'CLOSED' ? 'Z' : 'X'}
          </button>
          <div>
            <h4 className="font-semibold mb-1">Pembayaran</h4>
            <dl className="grid grid-cols-2 gap-y-1">
              {Object.entries(s.summary.byMethod).map(([m, v]) => (
                <div key={m} className="contents"><dt className="text-muted">{PAYMENT_METHODS[m] || m}</dt><dd className="text-right tabular-nums">{formatRupiah(v)}</dd></div>
              ))}
              {!Object.keys(s.summary.byMethod).length && <dd className="col-span-2 text-muted">-</dd>}
            </dl>
          </div>
          <div>
            <h4 className="font-semibold mb-1">Kas laci</h4>
            <dl className="grid grid-cols-2 gap-y-1">
              <dt className="text-muted">Modal awal</dt><dd className="text-right tabular-nums">{formatRupiah(s.openingCash)}</dd>
              <dt className="text-muted">+ Tunai</dt><dd className="text-right tabular-nums">{formatRupiah(s.summary.byMethod.CASH || 0)}</dd>
              <dt className="text-muted">+ Kas masuk</dt><dd className="text-right tabular-nums">{formatRupiah(s.summary.cashIn)}</dd>
              <dt className="text-muted">− Kas keluar</dt><dd className="text-right tabular-nums">{formatRupiah(s.summary.cashOut)}</dd>
              <dt className="font-semibold">Seharusnya</dt><dd className="text-right tabular-nums font-semibold">{formatRupiah(s.status === 'CLOSED' ? s.expectedCash : s.summary.expectedCash)}</dd>
              {s.status === 'CLOSED' && (
                <>
                  <dt className="text-muted">Dihitung</dt><dd className="text-right tabular-nums">{formatRupiah(s.closingCash)}</dd>
                  <dt className="text-muted">Selisih</dt><dd className="text-right tabular-nums">{diffCell(s.difference)}</dd>
                  {s.closeNote && <><dt className="text-muted">Catatan</dt><dd className="text-right">{s.closeNote}</dd></>}
                </>
              )}
            </dl>
          </div>
          {s.cashMoves.length > 0 && (
            <div>
              <h4 className="font-semibold mb-1">Kas masuk / keluar</h4>
              <ul className="divide-y divide-line-soft">
                {s.cashMoves.map((m) => (
                  <li key={m._id} className="flex justify-between gap-2 py-1">
                    <span>{formatDate2(m.date)} · {m.reason} <span className="text-muted">({m.by?.name})</span></span>
                    <span className={`tabular-nums ${m.type === 'OUT' ? 'text-danger' : ''}`}>{m.type === 'OUT' ? '−' : '+'}{formatRupiah(m.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h4 className="font-semibold mb-1">Transaksi ({s.sales.length})</h4>
            <ul className="divide-y divide-line-soft max-h-64 overflow-auto">
              {s.sales.map((x) => (
                <li key={x._id} className="flex justify-between gap-2 py-1">
                  {invPerm.canView
                    ? <Link to={`/sales-invoice/${x._id}`} className="font-mono text-xs font-semibold text-primary hover:underline">{x.no}</Link>
                    : <span className="font-mono text-xs">{x.no}</span>}
                  <span className="text-muted truncate">{formatDate2(x.date)} · {x.customer?.name}</span>
                  <span className={`tabular-nums ${x.status === 'CANCELLED' ? 'line-through text-muted' : ''}`}>{formatRupiah(x.total)}</span>
                </li>
              ))}
            </ul>
          </div>
          {s.status === 'OPEN' && perm.canUpdate && (
            <div className="rounded border border-line p-3 space-y-2">
              <h4 className="font-semibold">Tutup shift kasir ini</h4>
              <p className="text-xs text-muted">Untuk kasir yang lupa menutup shift. Hitung uang fisik di laci.</p>
              <input type="number" min="0" step="0.01" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="Uang fisik (Rp)" aria-label="Counted cash" className={`${inputClass} text-right tabular-nums`} />
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Catatan (wajib jika ada selisih)" aria-label="Note" className={inputClass} />
              <button type="button" onClick={close} disabled={busy} className="px-4 py-2 rounded text-sm bg-primary hover:bg-primary-hover text-primary-fg cursor-pointer disabled:opacity-50">Tutup shift</button>
            </div>
          )}
        </div>
      )}
    </SideDrawer>
  );
}

/** Laporan per kasir: shift dibuka pada periode, penjualan, metode bayar, void, retur, selisih kas */
function CashierReport({ token, outlets }) {
  const toast = useToast();
  const [q, setQ] = useState({ from: toDateInput(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), to: toDateInput(), outlet: '' });
  const [data, setData] = useState(null);
  useEffect(() => {
    const params = {};
    Object.entries(q).forEach(([k, v]) => { if (v) params[k] = v; });
    getCashierReport(token, params).then(setData).catch((err) => toast.error(err.response?.data?.message || 'Failed to load report'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, q]);
  const methods = data ? Object.keys(PAYMENT_METHODS).filter((m) => data.totals.byMethod[m] !== undefined) : [];
  const set = (k, v) => setQ((p) => ({ ...p, [k]: v }));
  const exportCsv = () => {
    const header = ['Cashier', 'Shifts', 'Transactions', 'Sales', 'Avg ticket', ...methods.map((m) => PAYMENT_METHODS[m]), 'Voids', 'Void value', 'Returns', 'Return value', 'Cash difference'];
    const row = (r, name) => [name, r.shifts, r.salesCount, r.salesTotal, r.avgTicket, ...methods.map((m) => r.byMethod[m] || 0), r.voidCount, r.voidTotal, r.returnCount, r.returnTotal, r.cashDifference];
    downloadCsv(`cashier-report-${q.from}_${q.to}.csv`, [header, ...data.rows.map((r) => row(r, r.cashier.name)), row(data.totals, 'TOTAL')]);
  };
  const th = 'px-3 py-2 border-b border-line font-semibold text-right';
  const td = 'px-3 py-1.5 border-t border-line-soft text-right tabular-nums';
  return (
    <div className="flex flex-col lg:min-h-0 lg:flex-1 p-4 bg-surface border border-line rounded-lg shadow-sm">
      <FilterBar>
        <input type="date" aria-label="From date" value={q.from} onChange={(e) => set('from', e.target.value)} className={selectClass} />
        <span className="text-muted text-sm">–</span>
        <input type="date" aria-label="To date" value={q.to} onChange={(e) => set('to', e.target.value)} className={selectClass} />
        <select aria-label="Outlet" value={q.outlet} onChange={(e) => set('outlet', e.target.value)} className={selectClass}>
          <option value="">All outlets</option>
          {outlets.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
        </select>
        <span className="text-xs text-muted">Menurut tanggal shift dibuka.</span>
        <button type="button" onClick={exportCsv} disabled={!data?.rows.length} className="ml-auto px-4 py-2 rounded border border-line hover:bg-subtle text-sm cursor-pointer disabled:opacity-50">
          <i className="fa fa-file-csv"></i> Export CSV
        </button>
      </FilterBar>
      <div className="overflow-auto max-h-[70vh] lg:max-h-none lg:min-h-0 lg:flex-1">
        <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: 900 }}>
          <thead className="bg-head text-head-fg sticky top-0">
            <tr>
              <th className={`${th} text-left`}>Cashier</th>
              <th className={th}>Shifts</th><th className={th}>Trx</th><th className={th}>Sales</th><th className={th}>Avg</th>
              {methods.map((m) => <th key={m} className={th}>{PAYMENT_METHODS[m]}</th>)}
              <th className={th}>Void</th><th className={th}>Retur</th><th className={th}>Selisih kas</th>
            </tr>
          </thead>
          <tbody>
            {!data && <tr><td colSpan={12} className="text-center py-8 text-muted">Loading...</td></tr>}
            {data?.rows.length === 0 && <tr><td colSpan={12} className="text-center py-8 text-muted">Tidak ada shift pada periode ini.</td></tr>}
            {data && [...data.rows, ...(data.rows.length ? [{ ...data.totals, cashier: { name: 'TOTAL' }, total: true }] : [])].map((r) => (
              <tr key={r.cashier._id || 'total'} className={r.total ? 'font-semibold' : 'hover:bg-subtle'}>
                <td className={`${td} text-left`}>{r.cashier.name}{r.openShifts ? <span className="ml-1.5 text-[10px] px-1 rounded bg-warning-soft text-warning-fg">{r.openShifts} open</span> : null}</td>
                <td className={td}>{r.shifts}</td>
                <td className={td}>{r.salesCount}</td>
                <td className={td}>{formatRupiah(r.salesTotal)}</td>
                <td className={td}>{formatRupiah(r.avgTicket)}</td>
                {methods.map((m) => <td key={m} className={td}>{formatRupiah(r.byMethod[m] || 0)}</td>)}
                <td className={td}>{r.voidCount ? `${r.voidCount} · ${formatRupiah(r.voidTotal)}` : '-'}</td>
                <td className={td}>{r.returnCount ? `${r.returnCount} · ${formatRupiah(r.returnTotal)}` : '-'}</td>
                <td className={td}>{diffCell(r.cashDifference)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Daftar shift kasir POS (izin posShift:view); ?tab=report = laporan per kasir */
export default function PosShift() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'report' ? 'report' : 'shifts';
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [outlets, setOutlets] = useState([]);
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    getOutletDropdown(user.token).then(setOutlets).catch(console.error);
  }, [user.token]);

  const fetchDocs = useCallback(async ({ search, page, pageSize }) => {
    const params = { search, page, pageSize };
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    const data = await getShifts(user.token, params);
    return { items: data.dataPosShift, total: data.totalData };
  }, [user.token, filters]);
  const table = useDataTable(fetchDocs, { defaultPageSize: 10 });
  const setFilter = (k, v) => {
    setFilters((f) => ({ ...f, [k]: v }));
    table.setCurrentPage(1);
  };

  const columns = [
    {
      key: 'no', header: 'Shift', width: 160,
      render: (d) => <button type="button" onClick={() => setOpenId(d._id)} className="font-mono text-sm font-semibold text-primary hover:underline cursor-pointer">{d.no}</button>,
    },
    { key: 'outlet', header: 'Outlet', width: 160, render: (d) => d.outlet?.name || '-' },
    { key: 'cashier', header: 'Cashier', width: 150, render: (d) => d.cashier?.name || '-' },
    { key: 'openedAt', header: 'Opened', width: 160, render: (d) => formatDate2(d.openedAt) },
    { key: 'closedAt', header: 'Closed', width: 160, render: (d) => (d.closedAt ? formatDate2(d.closedAt) : <span className="text-xs px-2 py-0.5 rounded bg-warning-soft text-warning-fg">Open</span>) },
    { key: 'salesCount', header: 'Trx', width: 70, className: 'text-right tabular-nums' },
    { key: 'salesTotal', header: 'Sales', width: 140, className: 'text-right tabular-nums', render: (d) => formatRupiah(d.salesTotal) },
    { key: 'expectedCash', header: 'Expected cash', width: 140, className: 'text-right tabular-nums', render: (d) => formatRupiah(d.expectedCash) },
    { key: 'closingCash', header: 'Counted', width: 140, className: 'text-right tabular-nums', render: (d) => (d.closingCash === null ? '-' : formatRupiah(d.closingCash)) },
    { key: 'difference', header: 'Difference', width: 130, className: 'text-right tabular-nums', render: (d) => diffCell(d.difference) },
  ];

  return (
    <div className="h-full p-4 flex flex-col overflow-y-auto lg:overflow-hidden">
      <PageHeader fallbackTitle="POS Shift" />
      <div role="tablist" className="mb-4 flex gap-1 border-b border-line">
        {[['shifts', 'Shifts', 'fa-clock'], ['report', 'Cashier report', 'fa-chart-column']].map(([k, l, icon]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setSearchParams(k === 'shifts' ? {} : { tab: k }, { replace: true })}
            className={`px-4 py-2 text-sm border-b-2 cursor-pointer ${tab === k ? 'border-primary text-primary font-medium' : 'border-transparent text-muted hover:text-fg'}`}>
            <i className={`fa ${icon} mr-1.5`}></i>{l}
          </button>
        ))}
      </div>
      {tab === 'report' ? <CashierReport token={user.token} outlets={outlets} /> : (
      <div className="flex flex-col lg:min-h-0 lg:flex-1 p-4 bg-surface border border-line rounded-lg shadow-sm">
        <FilterBar>
          <input type="search" placeholder="Search shift no..." aria-label="Search shift" value={table.searchInput}
            onChange={(e) => table.setSearchInput(e.target.value)} className={`${inputClass} max-w-xs`} />
          <select aria-label="Status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={selectClass}>
            <option value="">All status</option>
            <option value="OPEN">Open</option>
            <option value="CLOSED">Closed</option>
          </select>
          <select aria-label="Outlet" value={filters.outlet} onChange={(e) => setFilter('outlet', e.target.value)} className={selectClass}>
            <option value="">All outlets</option>
            {outlets.map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <input type="date" aria-label="From date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} className={selectClass} />
            <span className="text-muted text-sm">–</span>
            <input type="date" aria-label="To date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} className={selectClass} />
          </div>
        </FilterBar>
        <DataTable columns={columns} data={table.items} startIndex={table.startIndex} loading={table.loading} emptyText="No shift" />
        <Pagination currentPage={table.currentPage} totalItems={table.totalItems} pageSize={table.pageSize}
          onPageChange={table.setCurrentPage} onPageSizeChange={table.setPageSize} />
      </div>
      )}
      {openId && <ShiftDetail id={openId} token={user.token} onClose={() => setOpenId(null)} onChanged={table.reload} />}
    </div>
  );
}
