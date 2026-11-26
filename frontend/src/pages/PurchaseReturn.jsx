import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getPurchaseReturns } from '../services/purchaseService';
import { getVendorDropdown } from '../services/vendorService';
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
import { GR_STATUS_META, RETURN_RESOLUTIONS } from '../utils/purchaseMeta';

const EMPTY_FILTERS = { status: '', vendor: '', from: '', to: '' };
const selectClass = `${inputClass} sm:w-auto`;

/** Daftar retur pembelian (retur ke vendor) */
export default function PurchaseReturn() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const perm = usePermission('purchaseReturn');
  const canSeeCost = usePermission('vendorPrice').canView;
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [vendorList, setVendorList] = useState([]);

  useEffect(() => {
    getVendorDropdown(user.token).then(setVendorList).catch(console.error);
  }, [user.token]);

  const fetchDocs = useCallback(async ({ search, page, pageSize, sortField, sortOrder }) => {
    const params = { search, page, pageSize, sortField, sortOrder };
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    const data = await getPurchaseReturns(user.token, params);
    return { items: data.dataPurchaseReturn, total: data.totalData };
  }, [user.token, filters]);

  const table = useDataTable(fetchDocs, { defaultPageSize: 10 });
  const setFilter = (key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
    table.setCurrentPage(1);
  };
  const hasFilter = Object.values(filters).some(Boolean) || table.searchInput;

  const columns = [
    {
      key: 'no', header: 'Return No.', width: 160, sortField: 'no',
      render: (d) => <Link to={`/purchase-return/${d._id}`} className="font-mono text-sm font-semibold text-primary hover:underline">{d.no}</Link>,
    },
    { key: 'date', header: 'Date', width: 115, sortField: 'date', render: (d) => formatDay(d.date) },
    { key: 'gr', header: 'Goods receipt', width: 150, render: (d) => <span className="font-mono text-xs">{d.goodsReceipt?.no}</span> },
    { key: 'vendor', header: 'Vendor', width: 190, render: (d) => d.vendor?.companyName || '-' },
    { key: 'gudang', header: 'Warehouse', width: 100, render: (d) => d.gudang?.code || '-' },
    { key: 'resolution', header: 'Resolution', width: 150, render: (d) => RETURN_RESOLUTIONS[d.resolution]?.label },
    { key: 'totalQty', header: 'Qty', width: 90, className: 'text-right tabular-nums', render: (d) => formatNumber(d.totalQty) },
    ...(canSeeCost ? [{ key: 'total', header: 'Value', width: 140, sortField: 'total', className: 'text-right tabular-nums', render: (d) => formatRupiah(d.total) }] : []),
    { key: 'status', header: 'Status', width: 120, render: (d) => <StatusBadge status={d.status} meta={GR_STATUS_META} /> },
    { key: 'reason', header: 'Reason', width: 200 },
    { key: 'audit', header: 'Last Modified', width: 230, sortOptions: AUDIT_SORT_OPTIONS, render: (d) => <AuditCell row={d} sortField={table.sortField} /> },
  ];

  return (
    <div className="h-full p-4 flex flex-col">
      <PageHeader
        fallbackTitle="Purchase Return"
        actions={perm.canCreate && (
          <button type="button" onClick={() => navigate('/purchase-return/new')}
            className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded text-sm cursor-pointer">
            <i className="fa fa-plus"></i> New Purchase Return
          </button>
        )}
      />
      <div className="min-h-0 flex-1 flex flex-col p-4 bg-surface border border-line rounded-lg shadow-sm">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-48 max-w-sm">
            <i className="fa fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm"></i>
            <input type="search" placeholder="Search no., GR, vendor, reason..." aria-label="Search purchase return"
              value={table.searchInput} onChange={(e) => table.setSearchInput(e.target.value)} className={`${inputClass} pl-9`} />
          </div>
          <select aria-label="Status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={selectClass}>
            <option value="">All status</option>
            {Object.entries(GR_STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
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
          onSort={table.toggleSort} onSortSelect={table.setSort} startIndex={table.startIndex} loading={table.loading} emptyText="No purchase return" />
        <Pagination currentPage={table.currentPage} totalItems={table.totalItems} pageSize={table.pageSize}
          onPageChange={table.setCurrentPage} onPageSizeChange={table.setPageSize} />
      </div>
    </div>
  );
}
