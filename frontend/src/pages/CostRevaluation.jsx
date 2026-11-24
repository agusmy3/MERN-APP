import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getCostRevaluations } from '../services/stockService';
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
import { STATUS_META } from '../utils/stockMeta';

const EMPTY_FILTERS = { status: '', from: '', to: '' };
const selectClass = `${inputClass} sm:w-auto`;

/** Daftar dokumen revaluasi HPP. */
export default function CostRevaluation() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const perm = usePermission('costRevaluation');
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  const fetchDocs = useCallback(async ({ search, page, pageSize, sortField, sortOrder }) => {
    const params = { search, page, pageSize, sortField, sortOrder };
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    const data = await getCostRevaluations(user.token, params);
    return { items: data.dataCostRevaluation, total: data.totalData };
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
      render: (d) => <Link to={`/cost-revaluation/${d._id}`} className="font-mono text-sm font-semibold text-primary hover:underline">{d.no}</Link>,
    },
    { key: 'date', header: 'Date', width: 120, sortField: 'date', render: (d) => formatDay(d.date) },
    { key: 'note', header: 'Reason', width: 260 },
    { key: 'lineCount', header: 'SKU', width: 70, className: 'text-right tabular-nums' },
    {
      key: 'totalValueChange',
      header: 'Value change',
      width: 160,
      className: 'text-right tabular-nums',
      render: (d) => (d.totalValueChange === null || d.totalValueChange === undefined ? '' : (
        <span className={d.totalValueChange < 0 ? 'text-danger' : d.totalValueChange > 0 ? 'text-success-fg' : 'text-muted'}>{formatRupiah(d.totalValueChange)}</span>
      )),
    },
    { key: 'status', header: 'Status', width: 120, render: (d) => <StatusBadge status={d.status} /> },
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
        fallbackTitle="Cost Revaluation"
        actions={perm.canCreate && (
          <>
            <button type="button" onClick={() => navigate('/cost-revaluation/new?missing=1')}
              className="px-4 py-2 rounded border border-line hover:bg-subtle text-sm cursor-pointer">
              <i className="fa fa-triangle-exclamation"></i> Fill missing HPP
            </button>
            <button type="button" onClick={() => navigate('/cost-revaluation/new')}
              className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded text-sm cursor-pointer">
              <i className="fa fa-plus"></i> New Revaluation
            </button>
          </>
        )}
      />

      <div className="min-h-0 flex-1 flex flex-col p-4 bg-surface border border-line rounded-lg shadow-sm">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-48 max-w-sm">
            <i className="fa fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm"></i>
            <input type="search" placeholder="Search document no., reason..." aria-label="Search cost revaluation"
              value={table.searchInput} onChange={(e) => table.setSearchInput(e.target.value)} className={`${inputClass} pl-9`} />
          </div>
          <select aria-label="Status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={selectClass}>
            <option value="">All status</option>
            {Object.entries(STATUS_META).map(([key, m]) => <option key={key} value={key}>{m.label}</option>)}
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

        <DataTable
          columns={columns}
          data={table.items}
          sortField={table.sortField}
          sortOrder={table.sortOrder}
          onSort={table.toggleSort}
          onSortSelect={table.setSort}
          startIndex={table.startIndex}
          loading={table.loading}
          emptyText="No cost revaluation"
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
