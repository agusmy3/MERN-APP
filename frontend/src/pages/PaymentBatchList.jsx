import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import usePermission from '../hooks/usePermission';
import useDataTable from '../hooks/useDataTable';
import PageHeader from '../components/PageHeader';
import DataTable from '../components/DataTable';
import Pagination from '../components/Pagination';
import { AuditCell } from '../components/AuditInfo';
import { inputClass } from '../utils/formStyles';
import { formatDay } from '../utils/dateHelper';
import { formatRupiah } from '../utils/formatHelper';
import { AUDIT_SORT_OPTIONS } from '../utils/auditSort';
import { BATCH_KINDS } from '../components/payment/batchConfig';
import { BATCH_METHODS } from '../utils/paymentMeta';

import FilterBar from '../components/FilterBar';
const selectClass = `${inputClass} sm:w-auto`;

/** Daftar pembayaran gabungan: kind = 'customer' (/customer-receipt) | 'vendor' (/vendor-payment-batch) */
export default function PaymentBatchList({ kind }) {
  const cfg = BATCH_KINDS[kind];
  const { user } = useAuth();
  const navigate = useNavigate();
  const perm = usePermission(cfg.resource);
  const empty = { status: 'POSTED', [cfg.partyField]: '', from: '', to: '' };
  const [filters, setFilters] = useState(empty);
  const [parties, setParties] = useState([]);

  useEffect(() => {
    cfg.loadParties(user.token).then(setParties).catch(console.error);
  }, [cfg, user.token]);

  const fetchDocs = useCallback(async ({ search, page, pageSize, sortField, sortOrder }) => {
    const params = { search, page, pageSize, sortField, sortOrder };
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    const data = await cfg.list(user.token, params);
    return { items: data[cfg.listKey], total: data.totalData };
  }, [cfg, user.token, filters]);

  const table = useDataTable(fetchDocs, { defaultPageSize: 10 });
  const setFilter = (key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
    table.setCurrentPage(1);
  };

  const columns = [
    {
      key: 'no', header: 'No.', width: 160, sortField: 'no',
      render: (d) => <Link to={`${cfg.basePath}/${d._id}`} className="font-mono text-sm font-semibold text-primary hover:underline">{d.no}</Link>,
    },
    { key: 'date', header: 'Date', width: 115, sortField: 'date', render: (d) => formatDay(d.date) },
    { key: 'party', header: cfg.partyLabel, width: 200, render: (d) => cfg.partyName(d[cfg.partyField]) },
    { key: 'method', header: 'Method', width: 100, render: (d) => BATCH_METHODS[d.method] || d.method },
    {
      key: 'amount', header: 'Amount', width: 150, sortField: 'amount', className: 'text-right tabular-nums',
      render: (d) => <span className={d.status === 'CANCELLED' ? 'line-through text-muted' : ''}>{formatRupiah(d.amount)}</span>,
    },
    { key: 'invoices', header: `${cfg.invoiceLabel}s`, width: 240, render: (d) => (d.allocations || []).map((a) => a[cfg.invoiceField]?.no).join(', ') },
    { key: 'reference', header: 'Reference', width: 150 },
    {
      key: 'status', header: 'Status', width: 110,
      render: (d) => (d.status === 'CANCELLED'
        ? <span className="text-xs px-2 py-0.5 rounded bg-danger-soft text-danger" title={d.cancelReason}>Cancelled</span>
        : <span className="text-xs px-2 py-0.5 rounded bg-success-soft text-success-fg">Posted</span>),
    },
    { key: 'audit', header: 'Last Modified', width: 230, sortOptions: AUDIT_SORT_OPTIONS, render: (d) => <AuditCell row={d} sortField={table.sortField} /> },
  ];

  return (
    <div className="h-full p-4 flex flex-col overflow-y-auto lg:overflow-hidden">
      <PageHeader
        fallbackTitle={cfg.title}
        parentPath={cfg.parentPath}
        title={cfg.title}
        subtitle={cfg.subtitle}
        actions={perm.canCreate && (
          <button type="button" onClick={() => navigate(`${cfg.basePath}/new`)}
            className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded text-sm cursor-pointer">
            <i className="fa fa-plus"></i> {cfg.newTitle}
          </button>
        )}
      />
      <div className="flex flex-col lg:min-h-0 lg:flex-1 p-4 bg-surface border border-line rounded-lg shadow-sm">
        <FilterBar>
          <div className="relative flex-1 min-w-48 max-w-sm">
            <i className="fa fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm"></i>
            <input type="search" placeholder={`Search no., reference, ${cfg.partyLabel.toLowerCase()}...`} aria-label="Search"
              value={table.searchInput} onChange={(e) => table.setSearchInput(e.target.value)} className={`${inputClass} pl-9`} />
          </div>
          <select aria-label="Status" value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className={selectClass}>
            <option value="">All status</option>
            <option value="POSTED">Posted</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          <select aria-label={cfg.partyLabel} value={filters[cfg.partyField]} onChange={(e) => setFilter(cfg.partyField, e.target.value)} className={selectClass}>
            <option value="">All {cfg.partyLabel.toLowerCase()}s</option>
            {parties.map((p) => <option key={p._id} value={p._id}>{cfg.partyName(p)}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <input type="date" aria-label="From date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter('from', e.target.value)} className={selectClass} />
            <span className="text-muted text-sm">–</span>
            <input type="date" aria-label="To date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter('to', e.target.value)} className={selectClass} />
          </div>
        </FilterBar>
        <DataTable columns={columns} data={table.items} sortField={table.sortField} sortOrder={table.sortOrder}
          onSort={table.toggleSort} onSortSelect={table.setSort} startIndex={table.startIndex} loading={table.loading} emptyText="No payment" />
        <Pagination currentPage={table.currentPage} totalItems={table.totalItems} pageSize={table.pageSize}
          onPageChange={table.setCurrentPage} onPageSizeChange={table.setPageSize} />
      </div>
    </div>
  );
}
