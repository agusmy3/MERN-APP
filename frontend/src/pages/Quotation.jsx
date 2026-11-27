import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getQuotations, getCustomerDropdown } from '../services/salesService';
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
import { QUOTATION_STATUS_META, quotationStatus } from '../utils/salesMeta';

import FilterBar from '../components/FilterBar';
const EMPTY_FILTERS = { status: '', customer: '', from: '', to: '' };
const selectClass = `${inputClass} sm:w-auto`;

/** Daftar Quotation / penawaran harga. Query URL awal: ?status= */
export default function Quotation() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const perm = usePermission('quotation');
  const soPerm = usePermission('salesOrder');
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState(() => ({
    ...EMPTY_FILTERS,
    status: QUOTATION_STATUS_META[searchParams.get('status')] ? searchParams.get('status') : '',
  }));
  const [customerList, setCustomerList] = useState([]);

  useEffect(() => {
    getCustomerDropdown(user.token).then(setCustomerList).catch(console.error);
  }, [user.token]);

  const fetchDocs = useCallback(async ({ search, page, pageSize, sortField, sortOrder }) => {
    const params = { search, page, pageSize, sortField, sortOrder };
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    const data = await getQuotations(user.token, params);
    return { items: data.dataQuotation, total: data.totalData };
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
      header: 'Quotation No.',
      width: 165,
      sortField: 'no',
      render: (d) => <Link to={`/quotation/${d._id}`} className="font-mono text-sm font-semibold text-primary hover:underline">{d.no}</Link>,
    },
    { key: 'date', header: 'Date', width: 115, sortField: 'date', render: (d) => formatDay(d.date) },
    {
      key: 'customer',
      header: 'Customer',
      width: 210,
      render: (d) => (d.customer?.isWalkIn
        ? <span>{d.prospectName || '-'} <span className="text-[10px] px-1 py-0.5 rounded bg-subtle text-muted">prospect</span></span>
        : d.customer?.name || '-'),
    },
    {
      key: 'validUntil',
      header: 'Valid until',
      width: 120,
      sortField: 'validUntil',
      render: (d) => <span className={d.expired ? 'text-danger' : ''}>{formatDay(d.validUntil)}</span>,
    },
    { key: 'gudang', header: 'Warehouse', width: 100, render: (d) => d.gudang?.code || '-' },
    { key: 'lineCount', header: 'SKU', width: 65, className: 'text-right tabular-nums' },
    { key: 'total', header: 'Total', width: 145, sortField: 'total', className: 'text-right tabular-nums', render: (d) => formatRupiah(d.total) },
    { key: 'status', header: 'Status', width: 130, render: (d) => <StatusBadge status={quotationStatus(d)} meta={QUOTATION_STATUS_META} /> },
    {
      key: 'salesOrder',
      header: 'Sales Order',
      width: 150,
      render: (d) => (d.salesOrder ? (soPerm.canView
        ? <Link to={`/sales-order/${d.salesOrder._id}`} className="font-mono text-xs text-primary hover:underline">{d.salesOrder.no}</Link>
        : <span className="font-mono text-xs">{d.salesOrder.no}</span>) : ''),
    },
    { key: 'note', header: 'Note', width: 200 },
    { key: 'audit', header: 'Last Modified', width: 230, sortOptions: AUDIT_SORT_OPTIONS, render: (d) => <AuditCell row={d} sortField={table.sortField} /> },
    {
      key: 'action',
      header: '',
      width: 60,
      render: (d) => (
        <button type="button" title="Open" aria-label={`Open ${d.no}`} onClick={() => navigate(`/quotation/${d._id}`)}
          className="w-8 h-8 rounded-md border border-line text-muted hover:text-fg hover:bg-subtle cursor-pointer">
          <i className="fa fa-eye text-xs"></i>
        </button>
      ),
    },
  ];

  return (
    <div className="h-full p-4 flex flex-col overflow-y-auto lg:overflow-hidden">
      <PageHeader
        fallbackTitle="Quotation"
        actions={perm.canCreate && (
          <button type="button" onClick={() => navigate('/quotation/new')}
            className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded text-sm cursor-pointer">
            <i className="fa fa-plus"></i> New Quotation
          </button>
        )}
      />

      <div className="flex flex-col lg:min-h-0 lg:flex-1 p-4 bg-surface border border-line rounded-lg shadow-sm">
        <FilterBar>
          <div className="relative flex-1 min-w-48 max-w-sm">
            <i className="fa fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm"></i>
            <input type="search" placeholder="Search no., customer, prospect..." aria-label="Search quotation"
              value={table.searchInput} onChange={(e) => table.setSearchInput(e.target.value)} className={`${inputClass} pl-9`} />
          </div>
          <select aria-label="Status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={selectClass}>
            <option value="">All status</option>
            {Object.entries(QUOTATION_STATUS_META).map(([key, m]) => <option key={key} value={key}>{m.label}</option>)}
          </select>
          <select aria-label="Customer" value={filters.customer} onChange={(e) => setFilter('customer', e.target.value)} className={selectClass}>
            <option value="">All customers</option>
            {customerList.map((c) => <option key={c._id} value={c._id}>{c.isWalkIn ? 'Walk-in / prospect' : c.name}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <input type="date" aria-label="From date" value={filters.from} max={filters.to || undefined}
              onChange={(e) => setFilter('from', e.target.value)} className={selectClass} />
            <span className="text-muted text-sm">–</span>
            <input type="date" aria-label="To date" value={filters.to} min={filters.from || undefined}
              onChange={(e) => setFilter('to', e.target.value)} className={selectClass} />
          </div>
          {hasFilter && (
            <button type="button" onClick={() => { setFilters(EMPTY_FILTERS); table.setSearchInput(''); table.setCurrentPage(1); }}
              className="text-sm text-muted hover:text-fg cursor-pointer">
              <i className="fa fa-xmark"></i> Reset
            </button>
          )}
        </FilterBar>

        <DataTable columns={columns} data={table.items} sortField={table.sortField} sortOrder={table.sortOrder}
          onSort={table.toggleSort} onSortSelect={table.setSort} startIndex={table.startIndex} loading={table.loading} emptyText="No quotation" />
        <Pagination currentPage={table.currentPage} totalItems={table.totalItems} pageSize={table.pageSize}
          onPageChange={table.setCurrentPage} onPageSizeChange={table.setPageSize} />
      </div>
    </div>
  );
}
