import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAuditLogs } from '../services/auditLogService';
import { useAuth } from '../context/AuthContext';
import useDataTable from '../hooks/useDataTable';
import PageHeader from '../components/PageHeader';
import DataTable from '../components/DataTable';
import Pagination from '../components/Pagination';
import FormDrawer from '../components/FormDrawer';
import AuditChanges, { ActionBadge } from '../components/audit/AuditChanges';
import { inputClass } from '../utils/formStyles';
import { formatDate2 } from '../utils/dateHelper';
import { ACTION_META, ENTITY_META, LOGIN_REASON } from '../utils/auditFormat';

const EMPTY_FILTERS = { entity: '', action: '', from: '', to: '' };
const selectClass = `${inputClass} sm:w-auto`;

// ringkasan kolom "Changes": nama field yang berubah / alasan login gagal
const changeSummary = (log) => {
  if (log.action === 'login_failed') return LOGIN_REASON[log.meta?.reason] || log.meta?.reason;
  if (log.action === 'login') return log.ip ? `IP ${log.ip}` : null;
  if (log.action === 'delete') return `${log.changes?.length || 0} field (snapshot saved)`;
  return (log.changes || []).map((c) => c.label || c.field).join(', ');
};

// dokumen -> halamannya
const DOC_ROUTES = {
  stockAdjustment: '/stock-adjustment',
  purchaseOrder: '/purchase-order',
  goodsReceipt: '/goods-receipt',
  costRevaluation: '/cost-revaluation',
};

// produk / SKU / harga vendor -> halaman detail produk (tab History)
const produkIdOf = (log) => (log.entity === 'produk' ? log.entityId : log.parent?.entity === 'produk' ? log.parent.id : null);

/**
 * Audit Log global (izin auditLog:view). Isi tetap disaring backend sesuai izin view per resource.
 * Baca saja: log tidak bisa diubah atau dihapus.
 */
export default function AuditLog() {
  const { user } = useAuth();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [selected, setSelected] = useState(null);

  const fetchLogs = useCallback(async ({ search, page, pageSize, sortOrder }) => {
    const params = { search, page, pageSize, sortOrder };
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    const data = await getAuditLogs(user.token, params);
    return { items: data.logs, total: data.totalData };
  }, [user.token, filters]);

  const table = useDataTable(fetchLogs, { defaultSortField: 'date', defaultPageSize: 10 });

  const setFilter = (key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
    table.setCurrentPage(1);
  };
  const hasFilter = Object.values(filters).some(Boolean) || table.searchInput;

  const columns = [
    {
      key: 'date',
      header: 'Time',
      width: 160,
      sortField: 'date',
      render: (l) => <span className="tabular-nums">{formatDate2(l.date)}</span>,
    },
    { key: 'userName', header: 'User', width: 160, render: (l) => l.userName || '' },
    { key: 'action', header: 'Action', width: 130, render: (l) => <ActionBadge action={l.action} /> },
    {
      key: 'entity',
      header: 'Type',
      width: 140,
      render: (l) => (
        <span className="text-muted">
          <i className={`fa ${ENTITY_META[l.entity]?.icon || 'fa-circle'} mr-1.5 text-xs`}></i>
          {ENTITY_META[l.entity]?.label || l.entity}
        </span>
      ),
    },
    { key: 'entityLabel', header: 'Record', width: 240 },
    { key: 'changes', header: 'Changes', width: 280, render: changeSummary },
    {
      key: 'detail',
      header: '',
      width: 60,
      render: (l) => (
        <button
          type="button"
          title="Detail"
          aria-label="Detail"
          onClick={() => setSelected(l)}
          className="w-8 h-8 rounded-md border border-line text-muted hover:text-fg hover:bg-subtle cursor-pointer"
        >
          <i className="fa fa-eye text-xs"></i>
        </button>
      ),
    },
  ];

  const produkId = selected && produkIdOf(selected);

  return (
    <div className="h-full p-4 flex flex-col">
      <PageHeader fallbackTitle="Audit Log" />

      <div className="min-h-0 flex-1 flex flex-col p-4 bg-surface border border-line rounded-lg shadow-sm">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-48 max-w-sm">
            <i className="fa fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm"></i>
            <input
              type="search"
              placeholder="Search record, user, field..."
              aria-label="Search audit log"
              value={table.searchInput}
              onChange={(e) => table.setSearchInput(e.target.value)}
              className={`${inputClass} pl-9`}
            />
          </div>
          <select aria-label="Type" value={filters.entity} onChange={(e) => setFilter('entity', e.target.value)} className={selectClass}>
            <option value="">All types</option>
            {Object.entries(ENTITY_META).map(([key, m]) => <option key={key} value={key}>{m.label}</option>)}
          </select>
          <select aria-label="Action" value={filters.action} onChange={(e) => setFilter('action', e.target.value)} className={selectClass}>
            <option value="">All actions</option>
            {Object.entries(ACTION_META).map(([key, m]) => <option key={key} value={key}>{m.label}</option>)}
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
          startIndex={table.startIndex}
          loading={table.loading}
          emptyText="No audit log"
        />

        <Pagination
          currentPage={table.currentPage}
          totalItems={table.totalItems}
          pageSize={table.pageSize}
          onPageChange={table.setCurrentPage}
          onPageSizeChange={table.setPageSize}
        />
      </div>

      <FormDrawer
        open={!!selected}
        title="Audit Log Detail"
        onClose={() => setSelected(null)}
        onSubmit={(e) => e.preventDefault()}
        readOnly
        aside={selected && (
          <div className="space-y-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted">Time</dt><dd>{formatDate2(selected.date)}</dd>
              <dt className="text-muted">User</dt><dd>{selected.userName || '-'}</dd>
              <dt className="text-muted">Action</dt><dd><ActionBadge action={selected.action} /></dd>
              <dt className="text-muted">IP</dt><dd>{selected.ip || '-'}</dd>
              {selected.batchId && (<><dt className="text-muted">Batch</dt><dd className="font-mono text-xs break-all">{selected.batchId}</dd></>)}
            </dl>

            <div className="rounded border border-line p-3">
              <AuditChanges log={selected} />
            </div>

            {DOC_ROUTES[selected.entity] && selected.action !== 'delete' && (
              <Link to={`${DOC_ROUTES[selected.entity]}/${selected.entityId}`} className="inline-block text-sm text-primary hover:underline">
                <i className="fa fa-arrow-up-right-from-square mr-1"></i> Open document {selected.entityLabel}
              </Link>
            )}

            {produkId && selected.action !== 'delete' && (
              <Link to={`/produk/${produkId}?tab=history`} className="inline-block text-sm text-primary hover:underline">
                <i className="fa fa-arrow-up-right-from-square mr-1"></i> Open product history
              </Link>
            )}

            {selected.snapshot && (
              <details className="rounded border border-line">
                <summary className="px-3 py-2 text-sm font-medium cursor-pointer">Snapshot (data saat dihapus)</summary>
                <pre className="px-3 pb-3 text-xs overflow-auto max-h-80 whitespace-pre-wrap break-all">
                  {JSON.stringify(selected.snapshot, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}
      />
    </div>
  );
}
