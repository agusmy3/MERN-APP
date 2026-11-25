import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getSalesReturns, getCustomerDropdown } from '../services/salesService';
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
import { formatNumber, formatRupiah } from '../utils/formatHelper';
import { AUDIT_SORT_OPTIONS } from '../utils/auditSort';
import { RETURN_STATUS_META } from '../utils/salesMeta';

const EMPTY_FILTERS = { status: '', customer: '', gudang: '', from: '', to: '' };
const selectClass = `${inputClass} sm:w-auto`;

/**
 * Daftar Sales Return (retur atas invoice POSTED). Query URL awal: ?status=.
 * Retur baru dibuat dari halaman invoice (tombol Return) atau tombol New Return.
 */
export default function SalesReturn() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const perm = usePermission('salesReturn');
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState(() => ({
    ...EMPTY_FILTERS,
    status: RETURN_STATUS_META[searchParams.get('status')] ? searchParams.get('status') : '',
  }));
  const [gudangList, setGudangList] = useState([]);
  const [customerList, setCustomerList] = useState([]);

  useEffect(() => {
    getMyGudangDropdown(user.token).then(setGudangList).catch(console.error);
    getCustomerDropdown(user.token).then(setCustomerList).catch(console.error);
  }, [user.token]);

  const fetchDocs = useCallback(async ({ search, page, pageSize, sortField, sortOrder }) => {
    const params = { search, page, pageSize, sortField, sortOrder };
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    const data = await getSalesReturns(user.token, params);
    return { items: data.dataSalesReturn, total: data.totalData };
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
      header: 'Return No.',
      width: 170,
      sortField: 'no',
      render: (d) => (
        <Link to={`/sales-return/${d._id}`} className="font-mono text-sm font-semibold text-primary hover:underline">{d.no}</Link>
      ),
    },
    {
      key: 'invoice',
      header: 'Invoice',
      width: 160,
      render: (d) => (d.salesInvoice
        ? <Link to={`/sales-invoice/${d.salesInvoice._id}`} className="font-mono text-xs text-primary hover:underline">{d.salesInvoice.no}</Link>
        : '-'),
    },
    { key: 'date', header: 'Date', width: 120, sortField: 'date', render: (d) => formatDay(d.date) },
    { key: 'customer', header: 'Customer', width: 200, render: (d) => d.customer?.name || '-' },
    { key: 'gudang', header: 'Warehouse', width: 110, render: (d) => d.gudang?.code || '-' },
    { key: 'lineCount', header: 'SKU', width: 70, className: 'text-right tabular-nums' },
    { key: 'totalQty', header: 'Qty', width: 90, className: 'text-right tabular-nums', render: (d) => formatNumber(d.totalQty) },
    { key: 'total', header: 'Value', width: 150, sortField: 'total', className: 'text-right tabular-nums', render: (d) => formatRupiah(d.total) },
    { key: 'status', header: 'Status', width: 120, render: (d) => <StatusBadge status={d.status} meta={RETURN_STATUS_META} /> },
    { key: 'reason', header: 'Reason', width: 220 },
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
          onClick={() => navigate(`/sales-return/${d._id}`)}
          className="w-8 h-8 rounded-md border border-line text-muted hover:text-fg hover:bg-subtle cursor-pointer"
        >
          <i className="fa fa-eye text-xs"></i>
        </button>
      ),
    },
  ];

  return (
    <div className="h-full p-4 flex flex-col">
      <PageHeader
        fallbackTitle="Sales Return"
        actions={perm.canCreate && (
          <button
            type="button"
            onClick={() => navigate('/sales-return/new')}
            className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded text-sm cursor-pointer"
          >
            <i className="fa fa-plus"></i> New Return
          </button>
        )}
      />

      <div className="min-h-0 flex-1 flex flex-col p-4 bg-surface border border-line rounded-lg shadow-sm">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-48 max-w-sm">
            <i className="fa fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm"></i>
            <input
              type="search"
              placeholder="Search return / invoice no., customer, reason..."
              aria-label="Search sales return"
              value={table.searchInput}
              onChange={(e) => table.setSearchInput(e.target.value)}
              className={`${inputClass} pl-9`}
            />
          </div>
          <select aria-label="Status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={selectClass}>
            <option value="">All status</option>
            {Object.entries(RETURN_STATUS_META).map(([key, m]) => <option key={key} value={key}>{m.label}</option>)}
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
        </div>

        <DataTable
          columns={columns}
          data={table.items}
          sortField={table.sortField}
          sortOrder={table.sortOrder}
          onSort={table.toggleSort}
          onSortSelect={table.setSort}
          startIndex={table.startIndex}
          loading={table.loading}
          emptyText="No sales return"
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
