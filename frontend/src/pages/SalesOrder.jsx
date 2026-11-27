import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getSalesOrders, getCustomerDropdown } from '../services/salesService';
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
import { SO_STATUS_META, DELIVERY_METHODS } from '../utils/salesMeta';

import FilterBar from '../components/FilterBar';
const EMPTY_FILTERS = { status: '', customer: '', gudang: '', from: '', to: '' };
const STATUS_FILTERS = { ACTIVE: 'Open & partial', ...Object.fromEntries(Object.entries(SO_STATUS_META).map(([k, m]) => [k, m.label])) };
const selectClass = `${inputClass} sm:w-auto`;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

/** Daftar Sales Order. Query URL awal: ?status= (mis. ACTIVE dari dashboard). */
export default function SalesOrder() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const perm = usePermission('salesOrder');
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState(() => ({
    ...EMPTY_FILTERS,
    status: STATUS_FILTERS[searchParams.get('status')] ? searchParams.get('status') : '',
  }));
  const [gudangList, setGudangList] = useState([]);
  const [customerList, setCustomerList] = useState([]);

  useEffect(() => {
    getMyGudangDropdown(user.token).then(setGudangList).catch(console.error);
    getCustomerDropdown(user.token).then((list) => setCustomerList(list.filter((c) => !c.isWalkIn))).catch(console.error);
  }, [user.token]);

  const fetchDocs = useCallback(async ({ search, page, pageSize, sortField, sortOrder }) => {
    const params = { search, page, pageSize, sortField, sortOrder };
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    const data = await getSalesOrders(user.token, params);
    return { items: data.dataSalesOrder, total: data.totalData };
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
      header: 'SO No.',
      width: 160,
      sortField: 'no',
      render: (d) => <Link to={`/sales-order/${d._id}`} className="font-mono text-sm font-semibold text-primary hover:underline">{d.no}</Link>,
    },
    { key: 'date', header: 'Date', width: 115, sortField: 'date', render: (d) => formatDay(d.date) },
    { key: 'customer', header: 'Customer', width: 200, render: (d) => d.customer?.name || '-' },
    { key: 'customerPoNo', header: 'Customer PO', width: 130 },
    { key: 'gudang', header: 'Warehouse', width: 105, render: (d) => d.gudang?.code || '-' },
    {
      key: 'deliveryMethod',
      header: 'Method',
      width: 140,
      render: (d) => {
        const m = DELIVERY_METHODS[d.deliveryMethod];
        return m ? <span><i className={`fa ${m.icon} text-muted mr-1.5`}></i>{m.label}</span> : '-';
      },
    },
    {
      key: 'requestedDate',
      header: 'Requested',
      width: 120,
      sortField: 'requestedDate',
      render: (d) => {
        if (!d.requestedDate) return '';
        const late = ['OPEN', 'PARTIAL'].includes(d.status) && new Date(d.requestedDate) < startOfToday();
        return <span className={late ? 'text-danger font-semibold' : ''} title={late ? 'Lewat tanggal kirim yang diminta' : undefined}>{formatDay(d.requestedDate)}</span>;
      },
    },
    { key: 'lineCount', header: 'SKU', width: 65, className: 'text-right tabular-nums' },
    { key: 'total', header: 'Total', width: 145, sortField: 'total', className: 'text-right tabular-nums', render: (d) => formatRupiah(d.total) },
    { key: 'status', header: 'Status', width: 170, render: (d) => <StatusBadge status={d.status} meta={SO_STATUS_META} /> },
    {
      key: 'deliveredPercent',
      header: 'Delivered',
      width: 120,
      render: (d) => (['DRAFT', 'CANCELLED'].includes(d.status) ? '' : (
        <div className="flex items-center gap-2" title={`${d.deliveredPercent}% qty terkirim`}>
          <div className="h-1.5 flex-1 rounded bg-subtle overflow-hidden"><div className="h-full bg-primary" style={{ width: `${d.deliveredPercent}%` }}></div></div>
          <span className="text-xs tabular-nums text-muted w-9 text-right">{d.deliveredPercent}%</span>
        </div>
      )),
    },
    { key: 'note', header: 'Note', width: 200 },
    { key: 'audit', header: 'Last Modified', width: 230, sortOptions: AUDIT_SORT_OPTIONS, render: (d) => <AuditCell row={d} sortField={table.sortField} /> },
    {
      key: 'action',
      header: '',
      width: 60,
      render: (d) => (
        <button type="button" title="Open" aria-label={`Open ${d.no}`} onClick={() => navigate(`/sales-order/${d._id}`)}
          className="w-8 h-8 rounded-md border border-line text-muted hover:text-fg hover:bg-subtle cursor-pointer">
          <i className="fa fa-eye text-xs"></i>
        </button>
      ),
    },
  ];

  return (
    <div className="h-full p-4 flex flex-col overflow-y-auto lg:overflow-hidden">
      <PageHeader
        fallbackTitle="Sales Order"
        actions={perm.canCreate && (
          <button type="button" onClick={() => navigate('/sales-order/new')}
            className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded text-sm cursor-pointer">
            <i className="fa fa-plus"></i> New Sales Order
          </button>
        )}
      />

      <div className="flex flex-col lg:min-h-0 lg:flex-1 p-4 bg-surface border border-line rounded-lg shadow-sm">
        <FilterBar>
          <div className="relative flex-1 min-w-48 max-w-sm">
            <i className="fa fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm"></i>
            <input type="search" placeholder="Search SO no., customer PO, customer..." aria-label="Search sales order"
              value={table.searchInput} onChange={(e) => table.setSearchInput(e.target.value)} className={`${inputClass} pl-9`} />
          </div>
          <select aria-label="Status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={selectClass}>
            <option value="">All status</option>
            {Object.entries(STATUS_FILTERS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
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
            <button type="button" onClick={() => { setFilters(EMPTY_FILTERS); table.setSearchInput(''); table.setCurrentPage(1); }}
              className="text-sm text-muted hover:text-fg cursor-pointer">
              <i className="fa fa-xmark"></i> Reset
            </button>
          )}
        </FilterBar>

        <DataTable columns={columns} data={table.items} sortField={table.sortField} sortOrder={table.sortOrder}
          onSort={table.toggleSort} onSortSelect={table.setSort} startIndex={table.startIndex} loading={table.loading} emptyText="No sales order" />
        <Pagination currentPage={table.currentPage} totalItems={table.totalItems} pageSize={table.pageSize}
          onPageChange={table.setCurrentPage} onPageSizeChange={table.setPageSize} />
      </div>
    </div>
  );
}
