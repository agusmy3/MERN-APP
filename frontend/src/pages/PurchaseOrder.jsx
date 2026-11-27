import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getPurchaseOrders } from '../services/purchaseService';
import { getVendorDropdown } from '../services/vendorService';
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
import { PO_STATUS_META } from '../utils/purchaseMeta';

import FilterBar from '../components/FilterBar';
const EMPTY_FILTERS = { status: '', vendor: '', gudang: '', from: '', to: '' };
const selectClass = `${inputClass} sm:w-auto`;

/** Daftar Purchase Order. Klik nomor -> halaman PO (/purchase-order/:id). */
export default function PurchaseOrder() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const perm = usePermission('purchaseOrder');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [vendors, setVendors] = useState([]);
  const [gudangList, setGudangList] = useState([]);

  useEffect(() => {
    getVendorDropdown(user.token).then(setVendors).catch(console.error);
    getMyGudangDropdown(user.token).then(setGudangList).catch(console.error);
  }, [user.token]);

  const fetchDocs = useCallback(async ({ search, page, pageSize, sortField, sortOrder }) => {
    const params = { search, page, pageSize, sortField, sortOrder };
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    const data = await getPurchaseOrders(user.token, params);
    return { items: data.dataPurchaseOrder, total: data.totalData };
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
      header: 'PO No.',
      width: 160,
      sortField: 'no',
      render: (d) => (
        <Link to={`/purchase-order/${d._id}`} className="font-mono text-sm font-semibold text-primary hover:underline">{d.no}</Link>
      ),
    },
    { key: 'date', header: 'Date', width: 120, sortField: 'date', render: (d) => formatDay(d.date) },
    { key: 'vendor', header: 'Vendor', width: 200, render: (d) => d.vendor?.companyName || '-' },
    { key: 'gudang', header: 'Warehouse', width: 110, render: (d) => d.gudang?.code || '-' },
    { key: 'expectedDate', header: 'Expected', width: 120, sortField: 'expectedDate', render: (d) => (d.expectedDate ? formatDay(d.expectedDate) : '-') },
    { key: 'total', header: 'Total', width: 150, sortField: 'total', className: 'text-right tabular-nums', render: (d) => formatRupiah(d.total) },
    { key: 'status', header: 'Status', width: 170, render: (d) => <StatusBadge status={d.status} meta={PO_STATUS_META} /> },
    {
      key: 'progress',
      header: 'Received',
      width: 130,
      render: (d) => (['DRAFT', 'CANCELLED'].includes(d.status) ? '' : (
        <div className="flex items-center gap-2" title={`${d.receivedPercent}% diterima (satuan dasar)`}>
          <div className="flex-1 h-1.5 rounded bg-subtle overflow-hidden">
            <div className="h-full bg-primary" style={{ width: `${d.receivedPercent}%` }}></div>
          </div>
          <span className="text-xs tabular-nums text-muted w-9 text-right">{d.receivedPercent}%</span>
        </div>
      )),
    },
    {
      key: 'audit',
      header: 'Last Modified',
      width: 230,
      sortOptions: AUDIT_SORT_OPTIONS,
      render: (d) => <AuditCell row={d} sortField={table.sortField} />,
    },
  ];

  return (
    <div className="h-full p-4 flex flex-col overflow-y-auto lg:overflow-hidden">
      <PageHeader
        fallbackTitle="Purchase Order"
        actions={perm.canCreate && (
          <button
            type="button"
            onClick={() => navigate('/purchase-order/new')}
            className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded text-sm cursor-pointer"
          >
            <i className="fa fa-plus"></i> New Purchase Order
          </button>
        )}
      />

      <div className="flex flex-col lg:min-h-0 lg:flex-1 p-4 bg-surface border border-line rounded-lg shadow-sm">
        <FilterBar>
          <div className="relative flex-1 min-w-48 max-w-sm">
            <i className="fa fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm"></i>
            <input
              type="search"
              placeholder="Search PO no., note..."
              aria-label="Search purchase order"
              value={table.searchInput}
              onChange={(e) => table.setSearchInput(e.target.value)}
              className={`${inputClass} pl-9`}
            />
          </div>
          <select aria-label="Status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={selectClass}>
            <option value="">All status</option>
            <option value="ACTIVE">Open + Partial</option>
            {Object.entries(PO_STATUS_META).map(([key, m]) => <option key={key} value={key}>{m.label}</option>)}
          </select>
          <select aria-label="Vendor" value={filters.vendor} onChange={(e) => setFilter('vendor', e.target.value)} className={`${selectClass} max-w-52`}>
            <option value="">All vendors</option>
            {vendors.map((v) => <option key={v._id} value={v._id}>{v.companyName}</option>)}
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
          emptyText="No purchase order"
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
