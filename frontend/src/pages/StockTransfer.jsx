import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getStockTransfers } from '../services/stockService';
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
import { formatNumber, formatRupiah } from '../utils/formatHelper';
import { AUDIT_SORT_OPTIONS } from '../utils/auditSort';
import { TRANSFER_STATUS_META } from '../utils/stockMeta';

import FilterBar from '../components/FilterBar';
const EMPTY_FILTERS = { status: '', fromGudang: '', toGudang: '', from: '', to: '' };
const selectClass = `${inputClass} sm:w-auto`;

/**
 * Daftar Stock Transfer antar gudang. User yang dibatasi gudang hanya melihat transfer
 * dari / ke gudangnya. Filter "In transit" = kiriman yang menunggu diterima.
 * Query URL awal: ?status= (mis. dari dashboard).
 */
export default function StockTransfer() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const perm = usePermission('stockTransfer');
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState(() => ({
    ...EMPTY_FILTERS,
    status: TRANSFER_STATUS_META[searchParams.get('status')] ? searchParams.get('status') : '',
  }));
  const [gudangList, setGudangList] = useState([]);
  const [canSeeCost, setCanSeeCost] = useState(false);

  useEffect(() => {
    getGudangDropdown(user.token).then(setGudangList).catch(console.error);
  }, [user.token]);

  const fetchDocs = useCallback(async ({ search, page, pageSize, sortField, sortOrder }) => {
    const params = { search, page, pageSize, sortField, sortOrder };
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    const data = await getStockTransfers(user.token, params);
    setCanSeeCost(!!data.canSeeCost);
    return { items: data.dataStockTransfer, total: data.totalData };
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
      header: 'Transfer No.',
      width: 170,
      sortField: 'no',
      render: (d) => (
        <Link to={`/stock-transfer/${d._id}`} className="font-mono text-sm font-semibold text-primary hover:underline">{d.no}</Link>
      ),
    },
    { key: 'date', header: 'Date', width: 120, sortField: 'date', render: (d) => formatDay(d.date) },
    {
      key: 'route',
      header: 'From → To',
      width: 200,
      render: (d) => (
        <span className="whitespace-nowrap">
          <span className="font-medium">{d.fromGudang?.code || '?'}</span>
          <i className="fa fa-arrow-right mx-2 text-xs text-muted"></i>
          <span className="font-medium">{d.toGudang?.code || '?'}</span>
        </span>
      ),
    },
    { key: 'lineCount', header: 'SKU', width: 70, className: 'text-right tabular-nums' },
    {
      key: 'qty',
      header: 'Qty',
      width: 140,
      className: 'text-right tabular-nums',
      render: (d) => (
        <span title={d.totalReceived !== null ? 'Diterima / dikirim' : 'Dikirim'}>
          {d.totalReceived !== null && d.totalReceived !== undefined && (
            <span className={d.totalReceived < d.totalQty ? 'text-danger' : ''}>{formatNumber(d.totalReceived)} / </span>
          )}
          {formatNumber(d.totalQty)}
        </span>
      ),
    },
    { key: 'status', header: 'Status', width: 130, render: (d) => <StatusBadge status={d.status} meta={TRANSFER_STATUS_META} /> },
    ...(canSeeCost ? [{
      key: 'totalValue',
      header: 'Value',
      width: 140,
      className: 'text-right tabular-nums',
      render: (d) => (d.totalValue === null || d.totalValue === undefined ? '' : formatRupiah(d.totalValue)),
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
          onClick={() => navigate(`/stock-transfer/${d._id}`)}
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
        fallbackTitle="Stock Transfer"
        actions={perm.canCreate && (
          <button
            type="button"
            onClick={() => navigate('/stock-transfer/new')}
            className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded text-sm cursor-pointer"
          >
            <i className="fa fa-plus"></i> New Transfer
          </button>
        )}
      />

      <div className="flex flex-col lg:min-h-0 lg:flex-1 p-4 bg-surface border border-line rounded-lg shadow-sm">
        <FilterBar>
          <div className="relative flex-1 min-w-48 max-w-sm">
            <i className="fa fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm"></i>
            <input
              type="search"
              placeholder="Search transfer no., note..."
              aria-label="Search stock transfer"
              value={table.searchInput}
              onChange={(e) => table.setSearchInput(e.target.value)}
              className={`${inputClass} pl-9`}
            />
          </div>
          <select aria-label="Status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={selectClass}>
            <option value="">All status</option>
            {Object.entries(TRANSFER_STATUS_META).map(([key, m]) => <option key={key} value={key}>{m.label}</option>)}
          </select>
          <select aria-label="From warehouse" value={filters.fromGudang} onChange={(e) => setFilter('fromGudang', e.target.value)} className={selectClass}>
            <option value="">From: all</option>
            {gudangList.map((g) => <option key={g._id} value={g._id}>From: {g.code}</option>)}
          </select>
          <select aria-label="To warehouse" value={filters.toGudang} onChange={(e) => setFilter('toGudang', e.target.value)} className={selectClass}>
            <option value="">To: all</option>
            {gudangList.map((g) => <option key={g._id} value={g._id}>To: {g.code}</option>)}
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
          emptyText="No stock transfer"
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
