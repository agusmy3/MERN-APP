import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getSalesInvoices, getCustomerDropdown } from '../services/salesService';
import { getMyGudangDropdown } from '../services/gudangService';
import { useAuth } from '../context/AuthContext';
import usePermission from '../hooks/usePermission';
import useDataTable from '../hooks/useDataTable';
import PageHeader from '../components/PageHeader';
import DataTable from '../components/DataTable';
import Pagination from '../components/Pagination';
import StatusBadge from '../components/stock/StatusBadge';
import { AuditCell } from '../components/AuditInfo';
import { inputClass } from '../utils/formStyles';
import { formatDay } from '../utils/dateHelper';
import { formatRupiah } from '../utils/formatHelper';
import { AUDIT_SORT_OPTIONS } from '../utils/auditSort';
import { INVOICE_STATUS_META, PAYMENT_STATUS_META } from '../utils/salesMeta';

import FilterBar from '../components/FilterBar';
const EMPTY_FILTERS = { status: '', paymentStatus: '', customer: '', gudang: '', from: '', to: '' };
const PAYMENT_FILTERS = { OPEN: 'Not fully paid', OVERDUE: 'Overdue', ...Object.fromEntries(Object.entries(PAYMENT_STATUS_META).map(([k, m]) => [k, m.label])) };
const selectClass = `${inputClass} sm:w-auto`;

/**
 * Daftar Sales Invoice (penjualan langsung). Laba kotor hanya untuk user yang boleh melihat biaya.
 * Query URL awal: ?status= / ?paymentStatus= (mis. dari dashboard).
 */
export default function SalesInvoice() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const perm = usePermission('salesInvoice');
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState(() => ({
    ...EMPTY_FILTERS,
    status: INVOICE_STATUS_META[searchParams.get('status')] ? searchParams.get('status') : '',
    paymentStatus: PAYMENT_FILTERS[searchParams.get('paymentStatus')] ? searchParams.get('paymentStatus') : '',
  }));
  const [gudangList, setGudangList] = useState([]);
  const [customerList, setCustomerList] = useState([]);
  const [canSeeCost, setCanSeeCost] = useState(false);

  useEffect(() => {
    getMyGudangDropdown(user.token).then(setGudangList).catch(console.error);
    getCustomerDropdown(user.token).then(setCustomerList).catch(console.error);
  }, [user.token]);

  const fetchDocs = useCallback(async ({ search, page, pageSize, sortField, sortOrder }) => {
    const params = { search, page, pageSize, sortField, sortOrder };
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    const data = await getSalesInvoices(user.token, params);
    setCanSeeCost(!!data.canSeeCost);
    return { items: data.dataSalesInvoice, total: data.totalData };
  }, [user.token, filters]);

  const table = useDataTable(fetchDocs, { defaultPageSize: 10 });

  const setFilter = (key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
    table.setCurrentPage(1);
  };
  const hasFilter = Object.values(filters).some(Boolean) || table.searchInput;

  const columns = [
    {
      key: 'no',
      header: 'Invoice No.',
      width: 170,
      sortField: 'no',
      render: (d) => (
        <span>
          <Link to={`/sales-invoice/${d._id}`} className="font-mono text-sm font-semibold text-primary hover:underline">{d.no}</Link>
          {d.source === 'POS' && <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-primary-soft text-primary-soft-fg" title="Transaksi kasir POS">POS</span>}
          {d.source === 'SALES_ORDER' && <span className="ml-1.5 text-[10px] px-1 py-0.5 rounded bg-primary-soft text-primary-soft-fg" title={`Tagihan surat jalan ${(d.salesOrders || []).map((x) => x.no).join(', ')}`}>SO</span>}
        </span>
      ),
    },
    { key: 'date', header: 'Date', width: 120, sortField: 'date', render: (d) => formatDay(d.date) },
    { key: 'customer', header: 'Customer', width: 200, render: (d) => d.customer?.name || '-' },
    { key: 'gudang', header: 'Warehouse', width: 110, render: (d) => d.gudang?.code || '-' },
    { key: 'lineCount', header: 'SKU', width: 70, className: 'text-right tabular-nums' },
    { key: 'total', header: 'Total', width: 150, sortField: 'total', className: 'text-right tabular-nums', render: (d) => formatRupiah(d.total) },
    ...(canSeeCost ? [{
      key: 'grossProfit',
      header: 'Gross Profit',
      width: 150,
      className: 'text-right tabular-nums',
      render: (d) => (d.grossProfit === undefined || d.grossProfit === null ? ''
        : <span className={d.grossProfit < 0 ? 'text-danger' : ''}>{formatRupiah(d.grossProfit)}</span>),
    }] : []),
    { key: 'status', header: 'Status', width: 120, render: (d) => <StatusBadge status={d.status} meta={INVOICE_STATUS_META} /> },
    {
      key: 'paymentStatus',
      header: 'Payment',
      width: 150,
      render: (d) => (d.paymentStatus ? <StatusBadge status={d.paymentStatus} meta={PAYMENT_STATUS_META} /> : ''),
    },
    {
      key: 'balance',
      header: 'Balance',
      width: 140,
      className: 'text-right tabular-nums',
      render: (d) => (d.balance === undefined ? '' : <span className={d.balance < 0 ? 'text-danger' : ''}>{formatRupiah(d.balance)}</span>),
    },
    {
      key: 'dueDate',
      header: 'Due',
      width: 120,
      render: (d) => (d.status === 'POSTED' && d.dueDate
        ? <span className={d.overdue ? 'text-danger font-semibold' : ''} title={d.overdue ? 'Lewat jatuh tempo' : undefined}>{formatDay(d.dueDate)}</span>
        : ''),
    },
    { key: 'note', header: 'Note', width: 200 },
    {
      key: 'audit',
      header: 'Last Modified',
      width: 230,
      sortOptions: AUDIT_SORT_OPTIONS,
      render: (d) => <AuditCell row={d} sortField={table.sortField} />,
    },
    {
      key: 'action',
      header: '',
      width: 60,
      render: (d) => (
        <button
          type="button"
          title="Open"
          aria-label={`Open ${d.no}`}
          onClick={() => navigate(`/sales-invoice/${d._id}`)}
          className="w-8 h-8 rounded-md border border-line text-muted hover:text-fg hover:bg-subtle cursor-pointer"
        >
          <i className="fa fa-eye text-xs"></i>
        </button>
      ),
    },
  ];

  return (
    <div className="h-full p-4 flex flex-col overflow-y-auto lg:overflow-hidden">
      <PageHeader
        fallbackTitle="Sales Invoice"
        actions={perm.canCreate && (
          <button
            type="button"
            onClick={() => navigate('/sales-invoice/new')}
            className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded text-sm cursor-pointer"
          >
            <i className="fa fa-plus"></i> New Invoice
          </button>
        )}
      />

      <div className="flex flex-col lg:min-h-0 lg:flex-1 p-4 bg-surface border border-line rounded-lg shadow-sm">
        <FilterBar>
          <div className="relative flex-1 min-w-48 max-w-sm">
            <i className="fa fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm"></i>
            <input
              type="search"
              placeholder="Search invoice no., customer, note..."
              aria-label="Search sales invoice"
              value={table.searchInput}
              onChange={(e) => table.setSearchInput(e.target.value)}
              className={`${inputClass} pl-9`}
            />
          </div>
          <select aria-label="Status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={selectClass}>
            <option value="">All status</option>
            {Object.entries(INVOICE_STATUS_META).map(([key, m]) => <option key={key} value={key}>{m.label}</option>)}
          </select>
          <select aria-label="Payment status" value={filters.paymentStatus} onChange={(e) => setFilter('paymentStatus', e.target.value)} className={selectClass}>
            <option value="">All payments</option>
            {Object.entries(PAYMENT_FILTERS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <select aria-label="Customer" value={filters.customer} onChange={(e) => setFilter('customer', e.target.value)} className={selectClass}>
            <option value="">All customers</option>
            {customerList.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </select>
          <select aria-label="Warehouse" value={filters.gudang} onChange={(e) => setFilter('gudang', e.target.value)} className={selectClass}>
            <option value="">All warehouses</option>
            {gudangList.map((g) => <option key={g._id} value={g._id}>{g.code}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <input type="date" aria-label="From date" value={filters.from} max={filters.to || undefined}
              onChange={(e) => setFilter('from', e.target.value)} className={selectClass} />
            <span className="text-muted text-sm">–</span>
            <input type="date" aria-label="To date" value={filters.to} min={filters.from || undefined}
              onChange={(e) => setFilter('to', e.target.value)} className={selectClass} />
          </div>
          {hasFilter && (
            <button
              type="button"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                table.setSearchInput('');
                table.setCurrentPage(1);
              }}
              className="text-sm text-muted hover:text-fg cursor-pointer"
            >
              <i className="fa fa-xmark"></i> Reset
            </button>
          )}
        </FilterBar>

        <DataTable
          columns={columns}
          data={table.items}
          sortField={table.sortField}
          sortOrder={table.sortOrder}
          onSort={table.toggleSort}
          onSortSelect={table.setSort}
          startIndex={table.startIndex}
          loading={table.loading}
          emptyText="No sales invoice"
        />

        <Pagination
          currentPage={table.currentPage}
          totalItems={table.totalItems}
          pageSize={table.pageSize}
          onPageChange={table.setCurrentPage}
          onPageSizeChange={table.setPageSize}
        />
      </div>
    </div>
  );
}
