import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getVendorBills, getPayablesAging } from '../services/purchaseService';
import { getVendorDropdown } from '../services/vendorService';
import { useAuth } from '../context/AuthContext';
import usePermission from '../hooks/usePermission';
import useDataTable from '../hooks/useDataTable';
import useToast from '../hooks/useToast';
import PageHeader from '../components/PageHeader';
import DataTable from '../components/DataTable';
import Pagination from '../components/Pagination';
import StatusBadge from '../components/stock/StatusBadge';
import { AuditCell } from '../components/AuditInfo';
import { inputClass } from '../utils/formStyles';
import { formatDay, toDateInput } from '../utils/dateHelper';
import { formatRupiah } from '../utils/formatHelper';
import { AUDIT_SORT_OPTIONS } from '../utils/auditSort';
import { PAYMENT_STATUS_META } from '../utils/salesMeta';
import { BILL_STATUS_META } from '../utils/purchaseMeta';
import { downloadCsv } from '../utils/csvExport';

const EMPTY_FILTERS = { status: '', paymentStatus: '', vendor: '', from: '', to: '' };
const PAY_FILTERS = { OPEN: 'Belum lunas', OVERDUE: 'Lewat jatuh tempo', UNPAID: 'Unpaid', PARTIAL: 'Partially paid', PAID: 'Paid', OVERPAID: 'Overpaid' };
const BUCKETS = [['current', 'Not due'], ['d1_30', '1–30'], ['d31_60', '31–60'], ['d61_90', '61–90'], ['d90', '> 90']];
const selectClass = `${inputClass} sm:w-auto`;
const th = 'px-3 py-2 border-b border-line font-semibold';
const td = 'px-3 py-1.5 border-t border-line-soft';

/** Tab umur hutang per vendor (saat ini) */
function AgingTab({ token, vendors }) {
  const toast = useToast();
  const [vendor, setVendor] = useState('');
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(() => new Set());

  useEffect(() => {
    getPayablesAging(token, vendor ? { vendor } : {})
      .then(setData)
      .catch((err) => toast.error(err.response?.data?.message || 'Failed to load aging'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, vendor]);

  const toggle = (id) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const exportCsv = () => downloadCsv(`ap-aging-${toDateInput()}.csv`, [
    ['Vendor', ...BUCKETS.map(([, l]) => l), 'Total'],
    ...data.rows.map((r) => [r.vendor?.companyName || '', ...BUCKETS.map(([k]) => r[k]), r.total]),
  ]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select aria-label="Vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} className={selectClass}>
          <option value="">All vendors</option>
          {vendors.map((v) => <option key={v._id} value={v._id}>{v.companyName}</option>)}
        </select>
        <span className="text-sm text-muted">Per hari ini; hari = lewat dari jatuh tempo.</span>
        <button type="button" onClick={exportCsv} disabled={!data?.rows.length}
          className="ml-auto px-4 py-2 rounded border border-line hover:bg-subtle text-sm cursor-pointer disabled:opacity-50">
          <i className="fa fa-file-csv"></i> Export CSV
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: 900 }}>
          <thead className="bg-head text-head-fg text-left sticky top-0">
            <tr>
              <th className={th}>Vendor</th>
              {BUCKETS.map(([k, l]) => <th key={k} className={`${th} w-32 text-right`}>{l}</th>)}
              <th className={`${th} w-36 text-right`}>Total</th>
            </tr>
          </thead>
          <tbody>
            {!data && <tr><td colSpan={7} className="text-center py-8 text-muted">Loading...</td></tr>}
            {data?.rows.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-muted"><i className="fa fa-check mr-1 text-success-fg"></i>Tidak ada hutang terbuka.</td></tr>}
            {data?.rows.map((r) => (
              <Fragment key={r.vendor?._id}>
                <tr className="hover:bg-subtle cursor-pointer" onClick={() => toggle(r.vendor?._id)}>
                  <td className={td}>
                    <i className={`fa fa-chevron-${open.has(r.vendor?._id) ? 'down' : 'right'} text-xs text-muted mr-2`}></i>
                    {r.vendor?.companyName} <span className="text-xs text-muted">· {r.bills.length} bill</span>
                  </td>
                  {BUCKETS.map(([k]) => (
                    <td key={k} className={`${td} text-right tabular-nums ${r[k] && k !== 'current' ? 'text-danger' : r[k] ? '' : 'text-muted'}`}>{r[k] ? formatRupiah(r[k]) : '-'}</td>
                  ))}
                  <td className={`${td} text-right tabular-nums font-semibold`}>{formatRupiah(r.total)}</td>
                </tr>
                {open.has(r.vendor?._id) && r.bills.map((b) => (
                  <tr key={b._id} className="text-xs">
                    <td className={`${td} pl-9`}>
                      <Link to={`/purchase-invoice/${b._id}`} className="font-mono font-semibold text-primary hover:underline">{b.no}</Link>
                      <span className="text-muted"> · {b.vendorInvoiceNo || '-'} · due {formatDay(b.dueDate)}{b.daysOverdue > 0 ? ` (${b.daysOverdue} hari)` : ''}</span>
                    </td>
                    {BUCKETS.map(([k]) => <td key={k} className={`${td} text-right tabular-nums`}>{b.bucket === k ? formatRupiah(b.balance) : ''}</td>)}
                    <td className={`${td} text-right tabular-nums text-muted`}>of {formatRupiah(b.total)}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
            {data?.rows.length > 0 && (
              <tr className="font-semibold">
                <td className={td}>Total</td>
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

/** Daftar tagihan vendor (hutang) + tab umur hutang. Query URL: ?paymentStatus=OPEN|OVERDUE, ?tab=aging */
export default function PurchaseInvoice() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const perm = usePermission('purchaseInvoice');
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'aging' ? 'aging' : 'bills';
  const [filters, setFilters] = useState(() => ({
    ...EMPTY_FILTERS,
    paymentStatus: PAY_FILTERS[searchParams.get('paymentStatus')] ? searchParams.get('paymentStatus') : '',
  }));
  const [vendorList, setVendorList] = useState([]);

  useEffect(() => {
    getVendorDropdown(user.token).then(setVendorList).catch(console.error);
  }, [user.token]);

  const fetchDocs = useCallback(async ({ search, page, pageSize, sortField, sortOrder }) => {
    const params = { search, page, pageSize, sortField, sortOrder };
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    const data = await getVendorBills(user.token, params);
    return { items: data.dataPurchaseInvoice, total: data.totalData };
  }, [user.token, filters]);

  const table = useDataTable(fetchDocs, { defaultPageSize: 10 });
  const setFilter = (key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
    table.setCurrentPage(1);
  };
  const hasFilter = Object.values(filters).some(Boolean) || table.searchInput;

  const columns = [
    {
      key: 'no', header: 'Bill No.', width: 160, sortField: 'no',
      render: (d) => <Link to={`/purchase-invoice/${d._id}`} className="font-mono text-sm font-semibold text-primary hover:underline">{d.no}</Link>,
    },
    { key: 'vendorInvoiceNo', header: 'Vendor invoice', width: 140 },
    { key: 'date', header: 'Date', width: 115, sortField: 'date', render: (d) => formatDay(d.date) },
    { key: 'vendor', header: 'Vendor', width: 200, render: (d) => d.vendor?.companyName || '-' },
    { key: 'grs', header: 'Goods receipts', width: 180, render: (d) => (d.goodsReceipts || []).map((g) => g.no).join(', ') || (d.freightTotal ? 'Freight only' : '-') },
    { key: 'total', header: 'Total', width: 140, sortField: 'total', className: 'text-right tabular-nums', render: (d) => formatRupiah(d.total) },
    {
      key: 'balance', header: 'Balance', width: 140, className: 'text-right tabular-nums',
      render: (d) => (d.status === 'POSTED' ? <span className={d.overdue ? 'text-danger font-semibold' : ''}>{formatRupiah(d.balance)}</span> : ''),
    },
    {
      key: 'dueDate', header: 'Due', width: 115, sortField: 'dueDate',
      render: (d) => <span className={d.overdue ? 'text-danger font-semibold' : ''} title={d.overdue ? 'Lewat jatuh tempo' : undefined}>{formatDay(d.dueDate)}</span>,
    },
    {
      key: 'status', header: 'Status', width: 140,
      render: (d) => (d.status === 'POSTED' && d.paymentStatus
        ? <StatusBadge status={d.paymentStatus} meta={PAYMENT_STATUS_META} />
        : <StatusBadge status={d.status} meta={BILL_STATUS_META} />),
    },
    { key: 'note', header: 'Note', width: 200 },
    { key: 'audit', header: 'Last Modified', width: 230, sortOptions: AUDIT_SORT_OPTIONS, render: (d) => <AuditCell row={d} sortField={table.sortField} /> },
  ];

  const tabBtn = (key, label, icon) => (
    <button type="button" role="tab" aria-selected={tab === key}
      onClick={() => setSearchParams(key === 'bills' ? {} : { tab: key }, { replace: true })}
      className={`px-4 py-2 text-sm border-b-2 cursor-pointer ${tab === key ? 'border-primary text-primary font-medium' : 'border-transparent text-muted hover:text-fg'}`}>
      <i className={`fa ${icon} mr-1.5`}></i>{label}
    </button>
  );

  return (
    <div className="h-full p-4 flex flex-col">
      <PageHeader
        fallbackTitle="Vendor Bill"
        actions={perm.canCreate && (
          <button type="button" onClick={() => navigate('/purchase-invoice/new')}
            className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded text-sm cursor-pointer">
            <i className="fa fa-plus"></i> New Vendor Bill
          </button>
        )}
      />
      <div role="tablist" className="mb-4 flex gap-1 border-b border-line">
        {tabBtn('bills', 'Bills', 'fa-file-invoice-dollar')}
        {tabBtn('aging', 'Payables aging', 'fa-hourglass-half')}
      </div>
      {tab === 'aging' ? (
        <div className="min-h-0 flex-1 flex flex-col"><AgingTab token={user.token} vendors={vendorList} /></div>
      ) : (
        <div className="min-h-0 flex-1 flex flex-col p-4 bg-surface border border-line rounded-lg shadow-sm">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-48 max-w-sm">
              <i className="fa fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm"></i>
              <input type="search" placeholder="Search bill no., vendor invoice, vendor..." aria-label="Search vendor bill"
                value={table.searchInput} onChange={(e) => table.setSearchInput(e.target.value)} className={`${inputClass} pl-9`} />
            </div>
            <select aria-label="Status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={selectClass}>
              <option value="">All status</option>
              {Object.entries(BILL_STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
            <select aria-label="Payment status" value={filters.paymentStatus} onChange={(e) => setFilter('paymentStatus', e.target.value)} className={selectClass}>
              <option value="">All payments</option>
              {Object.entries(PAY_FILTERS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <select aria-label="Vendor" value={filters.vendor} onChange={(e) => setFilter('vendor', e.target.value)} className={selectClass}>
              <option value="">All vendors</option>
              {vendorList.map((v) => <option key={v._id} value={v._id}>{v.companyName}</option>)}
            </select>
            <div className="flex items-center gap-2">
              <input type="date" aria-label="From date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter('from', e.target.value)} className={selectClass} />
              <span className="text-muted text-sm">–</span>
              <input type="date" aria-label="To date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter('to', e.target.value)} className={selectClass} />
            </div>
            {hasFilter && (
              <button type="button" onClick={() => { setFilters(EMPTY_FILTERS); table.setSearchInput(''); table.setCurrentPage(1); }}
                className="text-sm text-muted hover:text-fg cursor-pointer">
                <i className="fa fa-xmark"></i> Reset
              </button>
            )}
          </div>
          <DataTable columns={columns} data={table.items} sortField={table.sortField} sortOrder={table.sortOrder}
            onSort={table.toggleSort} onSortSelect={table.setSort} startIndex={table.startIndex} loading={table.loading} emptyText="No vendor bill" />
          <Pagination currentPage={table.currentPage} totalItems={table.totalItems} pageSize={table.pageSize}
            onPageChange={table.setCurrentPage} onPageSizeChange={table.setPageSize} />
        </div>
      )}
    </div>
  );
}
