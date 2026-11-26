import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getDeliveryOrders, getCustomerDropdown } from '../services/salesService';
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
import { formatNumber } from '../utils/formatHelper';
import { AUDIT_SORT_OPTIONS } from '../utils/auditSort';
import { DO_STATUS_META, DELIVERY_METHODS } from '../utils/salesMeta';

const EMPTY_FILTERS = { status: '', invoiced: '', customer: '', gudang: '', from: '', to: '' };
const INVOICE_FILTERS = { false: 'Belum ditagih', true: 'Sudah ditagih' };
const selectClass = `${inputClass} sm:w-auto`;

/** Daftar Delivery Order / surat jalan. Query URL awal: ?status= / ?invoiced=false (dari dashboard). */
export default function DeliveryOrder() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const perm = usePermission('deliveryOrder');
  const invoicePerm = usePermission('salesInvoice');
  const soPerm = usePermission('salesOrder');
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState(() => ({
    ...EMPTY_FILTERS,
    status: DO_STATUS_META[searchParams.get('status')] ? searchParams.get('status') : '',
    invoiced: INVOICE_FILTERS[searchParams.get('invoiced')] ? searchParams.get('invoiced') : '',
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
    const data = await getDeliveryOrders(user.token, params);
    return { items: data.dataDeliveryOrder, total: data.totalData };
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
      header: 'DO No.',
      width: 160,
      sortField: 'no',
      render: (d) => <Link to={`/delivery-order/${d._id}`} className="font-mono text-sm font-semibold text-primary hover:underline">{d.no}</Link>,
    },
    { key: 'date', header: 'Date', width: 115, sortField: 'date', render: (d) => formatDay(d.date) },
    {
      key: 'salesOrder',
      header: 'Sales Order',
      width: 150,
      render: (d) => (d.salesOrder ? (soPerm.canView
        ? <Link to={`/sales-order/${d.salesOrder._id}`} className="font-mono text-xs text-primary hover:underline">{d.salesOrder.no}</Link>
        : <span className="font-mono text-xs">{d.salesOrder.no}</span>) : '-'),
    },
    { key: 'customer', header: 'Customer', width: 190, render: (d) => d.customer?.name || '-' },
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
    { key: 'trackingNo', header: 'Vehicle / Tracking', width: 150, render: (d) => [d.vehicleNo, d.trackingNo, d.pickedUpBy].filter(Boolean).join(' · ') },
    { key: 'lineCount', header: 'SKU', width: 65, className: 'text-right tabular-nums' },
    { key: 'totalQty', header: 'Qty', width: 90, className: 'text-right tabular-nums', render: (d) => formatNumber(d.totalQty) },
    { key: 'status', header: 'Status', width: 120, render: (d) => <StatusBadge status={d.status} meta={DO_STATUS_META} /> },
    {
      key: 'invoice',
      header: 'Invoice',
      width: 160,
      render: (d) => {
        if (d.status !== 'POSTED') return '';
        if (!d.invoice) return <span className="text-xs px-1.5 py-0.5 rounded bg-warning-soft text-warning-fg">Belum ditagih</span>;
        return invoicePerm.canView
          ? <Link to={`/sales-invoice/${d.invoice._id}`} className="font-mono text-xs text-primary hover:underline">{d.invoice.no}</Link>
          : <span className="font-mono text-xs">{d.invoice.no}</span>;
      },
    },
    { key: 'note', header: 'Note', width: 180 },
    { key: 'audit', header: 'Last Modified', width: 230, sortOptions: AUDIT_SORT_OPTIONS, render: (d) => <AuditCell row={d} sortField={table.sortField} /> },
    {
      key: 'action',
      header: '',
      width: 60,
      render: (d) => (
        <button type="button" title="Open" aria-label={`Open ${d.no}`} onClick={() => navigate(`/delivery-order/${d._id}`)}
          className="w-8 h-8 rounded-md border border-line text-muted hover:text-fg hover:bg-subtle cursor-pointer">
          <i className="fa fa-eye text-xs"></i>
        </button>
      ),
    },
  ];

  return (
    <div className="h-full p-4 flex flex-col">
      <PageHeader
        fallbackTitle="Delivery Order"
        actions={perm.canCreate && (
          <button type="button" onClick={() => navigate('/delivery-order/new')}
            className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded text-sm cursor-pointer">
            <i className="fa fa-plus"></i> New Delivery Order
          </button>
        )}
      />

      <div className="min-h-0 flex-1 flex flex-col p-4 bg-surface border border-line rounded-lg shadow-sm">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-48 max-w-sm">
            <i className="fa fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm"></i>
            <input type="search" placeholder="Search DO / SO no., tracking, customer..." aria-label="Search delivery order"
              value={table.searchInput} onChange={(e) => table.setSearchInput(e.target.value)} className={`${inputClass} pl-9`} />
          </div>
          <select aria-label="Status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={selectClass}>
            <option value="">All status</option>
            {Object.entries(DO_STATUS_META).map(([key, m]) => <option key={key} value={key}>{m.label}</option>)}
          </select>
          <select aria-label="Invoice status" value={filters.invoiced} onChange={(e) => setFilter('invoiced', e.target.value)} className={selectClass}>
            <option value="">All invoices</option>
            {Object.entries(INVOICE_FILTERS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
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
        </div>

        <DataTable columns={columns} data={table.items} sortField={table.sortField} sortOrder={table.sortOrder}
          onSort={table.toggleSort} onSortSelect={table.setSort} startIndex={table.startIndex} loading={table.loading} emptyText="No delivery order" />
        <Pagination currentPage={table.currentPage} totalItems={table.totalItems} pageSize={table.pageSize}
          onPageChange={table.setCurrentPage} onPageSizeChange={table.setPageSize} />
      </div>
    </div>
  );
}
