import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getStockAdjustments } from '../services/stockService';
import { getGudangDropdown } from '../services/gudangService';
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
import { ADJUSTMENT_TYPES, REASONS, STATUS_META } from '../utils/stockMeta';

const EMPTY_FILTERS = { status: '', type: '', gudang: '', from: '', to: '' };
const selectClass = `${inputClass} sm:w-auto`;

/**
 * Daftar dokumen Stock Adjustment & Stock Opname. Klik nomor dokumen -> halaman dokumen
 * (/stock-adjustment/:id) untuk mengisi draft, Post, atau Cancel.
 */
export default function StockAdjustment() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const perm = usePermission('stockAdjustment');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [gudangList, setGudangList] = useState([]);
  const [canSeeCost, setCanSeeCost] = useState(false);

  useEffect(() => {
    getGudangDropdown(user.token).then(setGudangList).catch(console.error);
  }, [user.token]);

  const fetchDocs = useCallback(async ({ search, page, pageSize, sortField, sortOrder }) => {
    const params = { search, page, pageSize, sortField, sortOrder };
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    const data = await getStockAdjustments(user.token, params);
    setCanSeeCost(!!data.canSeeCost);
    return { items: data.dataStockAdjustment, total: data.totalData };
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
      header: 'Document No.',
      width: 170,
      sortField: 'no',
      render: (d) => (
        <Link to={`/stock-adjustment/${d._id}`} className="font-mono text-sm font-semibold text-primary hover:underline">
          {d.no}
        </Link>
      ),
    },
    { key: 'date', header: 'Date', width: 120, sortField: 'date', render: (d) => formatDay(d.date) },
    {
      key: 'type',
      header: 'Type',
      width: 150,
      render: (d) => (
        <span className="text-muted">
          <i className={`fa ${ADJUSTMENT_TYPES[d.type]?.icon || 'fa-circle'} mr-1.5 text-xs`}></i>
          {ADJUSTMENT_TYPES[d.type]?.label || d.type}
        </span>
      ),
    },
    { key: 'gudang', header: 'Warehouse', width: 140, render: (d) => d.gudang?.code || '-' },
    { key: 'reason', header: 'Reason', width: 160, render: (d) => REASONS[d.reason] || d.reason },
    { key: 'lineCount', header: 'SKU', width: 70, className: 'text-right tabular-nums' },
    { key: 'status', header: 'Status', width: 120, render: (d) => <StatusBadge status={d.status} /> },
    ...(canSeeCost ? [{
      key: 'totalValue',
      header: 'Value',
      width: 150,
      className: 'text-right tabular-nums',
      render: (d) => (d.totalValue === null || d.totalValue === undefined ? '' : (
        <span className={d.totalValue < 0 ? 'text-danger' : d.totalValue > 0 ? 'text-success-fg' : 'text-muted'}>{formatRupiah(d.totalValue)}</span>
      )),
    }] : []),
    { key: 'note', header: 'Note', width: 220 },
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
          onClick={() => navigate(`/stock-adjustment/${d._id}`)}
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
        fallbackTitle="Stock Adjustment"
        actions={perm.canCreate && (
          <>
            <button
              type="button"
              onClick={() => navigate('/stock-adjustment/new?type=OPNAME')}
              className="px-4 py-2 rounded border border-line hover:bg-subtle text-sm cursor-pointer"
            >
              <i className="fa fa-clipboard-check"></i> New Stock Opname
            </button>
            <button
              type="button"
              onClick={() => navigate('/stock-adjustment/new?type=ADJUSTMENT')}
              className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded text-sm cursor-pointer"
            >
              <i className="fa fa-plus"></i> New Adjustment
            </button>
          </>
        )}
      />

      <div className="min-h-0 flex-1 flex flex-col p-4 bg-surface border border-line rounded-lg shadow-sm">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-48 max-w-sm">
            <i className="fa fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm"></i>
            <input
              type="search"
              placeholder="Search document no., note..."
              aria-label="Search stock adjustment"
              value={table.searchInput}
              onChange={(e) => table.setSearchInput(e.target.value)}
              className={`${inputClass} pl-9`}
            />
          </div>
          <select aria-label="Status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={selectClass}>
            <option value="">All status</option>
            {Object.entries(STATUS_META).map(([key, m]) => <option key={key} value={key}>{m.label}</option>)}
          </select>
          <select aria-label="Type" value={filters.type} onChange={(e) => setFilter('type', e.target.value)} className={selectClass}>
            <option value="">All types</option>
            {Object.entries(ADJUSTMENT_TYPES).map(([key, m]) => <option key={key} value={key}>{m.label}</option>)}
          </select>
          <select aria-label="Warehouse" value={filters.gudang} onChange={(e) => setFilter('gudang', e.target.value)} className={selectClass}>
            <option value="">All warehouses</option>
            {gudangList.map((g) => <option key={g._id} value={g._id}>{g.code} — {g.name}</option>)}
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
          emptyText="No stock adjustment"
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
