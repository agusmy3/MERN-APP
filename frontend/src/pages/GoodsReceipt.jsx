import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getGoodsReceipts } from '../services/purchaseService';
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
import { AUDIT_SORT_OPTIONS } from '../utils/auditSort';
import { GR_STATUS_META } from '../utils/purchaseMeta';

const EMPTY_FILTERS = { status: '', billed: '', vendor: '', gudang: '', from: '', to: '' };
const BILLED_FILTERS = { false: 'Belum ditagih', true: 'Sudah ditagih' };
const selectClass = `${inputClass} sm:w-auto`;

/** Daftar Goods Receipt (penerimaan barang dari PO). Query URL awal: ?billed=false (dari dashboard). */
export default function GoodsReceipt() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const perm = usePermission('goodsReceipt');
  const poPerm = usePermission('purchaseOrder');
  const billPerm = usePermission('purchaseInvoice');
  const pricePerm = usePermission('vendorPrice');
  const canSeeBill = billPerm.canView && pricePerm.canView;
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState(() => ({ ...EMPTY_FILTERS, billed: BILLED_FILTERS[searchParams.get('billed')] ? searchParams.get('billed') : '' }));
  const [vendors, setVendors] = useState([]);
  const [gudangList, setGudangList] = useState([]);

  useEffect(() => {
    getVendorDropdown(user.token).then(setVendors).catch(console.error);
    getMyGudangDropdown(user.token).then(setGudangList).catch(console.error);
  }, [user.token]);

  const fetchDocs = useCallback(async ({ search, page, pageSize, sortField, sortOrder }) => {
    const params = { search, page, pageSize, sortField, sortOrder };
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    const data = await getGoodsReceipts(user.token, params);
    return { items: data.dataGoodsReceipt, total: data.totalData };
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
      header: 'GR No.',
      width: 160,
      sortField: 'no',
      render: (d) => <Link to={`/goods-receipt/${d._id}`} className="font-mono text-sm font-semibold text-primary hover:underline">{d.no}</Link>,
    },
    { key: 'date', header: 'Date', width: 120, sortField: 'date', render: (d) => formatDay(d.date) },
    {
      key: 'purchaseOrder',
      header: 'PO',
      width: 160,
      render: (d) => (poPerm.canView && d.purchaseOrder
        ? <Link to={`/purchase-order/${d.purchaseOrder._id}`} className="font-mono text-xs hover:text-primary hover:underline">{d.purchaseOrder.no}</Link>
        : <span className="font-mono text-xs">{d.purchaseOrder?.no}</span>),
    },
    { key: 'vendor', header: 'Vendor', width: 200, render: (d) => d.vendor?.companyName || '-' },
    { key: 'gudang', header: 'Warehouse', width: 110, render: (d) => d.gudang?.code || '-' },
    { key: 'deliveryNoteNo', header: 'Delivery Note', width: 150 },
    { key: 'lineCount', header: 'Items', width: 70, className: 'text-right tabular-nums' },
    { key: 'status', header: 'Status', width: 120, render: (d) => <StatusBadge status={d.status} meta={GR_STATUS_META} /> },
    ...(canSeeBill ? [{
      key: 'bill',
      header: 'Vendor bill',
      width: 150,
      render: (d) => (d.status !== 'POSTED' ? '' : d.purchaseInvoice
        ? <Link to={`/purchase-invoice/${d.purchaseInvoice._id}`} className="font-mono text-xs text-primary hover:underline">{d.purchaseInvoice.no}</Link>
        : <span className="text-xs px-1.5 py-0.5 rounded bg-warning-soft text-warning-fg">Belum ditagih</span>),
    }] : []),
    {
      key: 'audit',
      header: 'Last Modified',
      width: 230,
      sortOptions: AUDIT_SORT_OPTIONS,
      render: (d) => <AuditCell row={d} sortField={table.sortField} />,
    },
  ];

  return (
    <div className="h-full p-4 flex flex-col">
      <PageHeader
        fallbackTitle="Goods Receipt"
        actions={perm.canCreate && (
          <button
            type="button"
            onClick={() => navigate('/goods-receipt/new')}
            className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded text-sm cursor-pointer"
          >
            <i className="fa fa-plus"></i> New Goods Receipt
          </button>
        )}
      />

      <div className="min-h-0 flex-1 flex flex-col p-4 bg-surface border border-line rounded-lg shadow-sm">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-48 max-w-sm">
            <i className="fa fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm"></i>
            <input
              type="search"
              placeholder="Search GR / PO no., delivery note..."
              aria-label="Search goods receipt"
              value={table.searchInput}
              onChange={(e) => table.setSearchInput(e.target.value)}
              className={`${inputClass} pl-9`}
            />
          </div>
          <select aria-label="Status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={selectClass}>
            <option value="">All status</option>
            {Object.entries(GR_STATUS_META).map(([key, m]) => <option key={key} value={key}>{m.label}</option>)}
          </select>
          {canSeeBill && (
            <select aria-label="Billing" value={filters.billed} onChange={(e) => setFilter('billed', e.target.value)} className={selectClass}>
              <option value="">All billing</option>
              {Object.entries(BILLED_FILTERS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          )}
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
          emptyText="No goods receipt"
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
