import { useCallback, useEffect, useState } from 'react';
import { getAuditHistory } from '../../services/auditLogService';
import { useAuth } from '../../context/AuthContext';
import { formatDate2 } from '../../utils/dateHelper';
import { groupByBatch, summarizeGroup } from '../../utils/auditFormat';
import AuditChanges, { ActionBadge } from './AuditChanges';

const PAGE_SIZE = 20;
const COLLAPSE_AFTER = 3; // grup besar (mis. hapus produk + 20 SKU) dilipat

function Group({ group }) {
  const [expanded, setExpanded] = useState(false);
  const first = group.logs[0];
  const multi = group.logs.length > 1;
  const visible = expanded ? group.logs : group.logs.slice(0, COLLAPSE_AFTER);
  const hidden = group.logs.length - visible.length;

  return (
    <li className="relative pl-7">
      <span className="absolute left-0 top-0.5 w-5 h-5 rounded-full bg-primary-soft text-primary-soft-fg text-[10px] font-bold flex items-center justify-center">
        {(first.userName || '?').charAt(0).toUpperCase()}
      </span>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-semibold text-fg">{first.userName || 'Unknown'}</span>
        <span className="text-xs text-muted">{formatDate2(first.date)}</span>
        {!multi && <ActionBadge action={first.action} />}
      </div>
      {multi && <div className="text-xs font-medium text-muted mt-0.5">{summarizeGroup(group.logs)}</div>}

      <div className={`mt-1.5 space-y-2 ${multi ? 'border-l-2 border-line pl-3' : ''}`}>
        {visible.map((log) => (
          <div key={log._id}>
            {multi && <div className="mb-0.5"><ActionBadge action={log.action} /></div>}
            <AuditChanges log={log} />
          </div>
        ))}
        {hidden > 0 && (
          <button type="button" onClick={() => setExpanded(true)} className="text-xs text-primary hover:underline cursor-pointer">
            Show {hidden} more
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * Timeline histori 1 record (GET /api/audit-log/history).
 * entity: 'produk' | 'role' | 'user'. scopes: [{ key, label }] untuk filter chip (opsional).
 * `refreshKey` berubah -> dimuat ulang (mis. setelah data disimpan).
 */
export default function AuditTimeline({ entity, id, scopes = [], refreshKey }) {
  const { user } = useAuth();
  const [scope, setScope] = useState('');
  const [state, setState] = useState({ logs: [], page: 0, totalPages: 0, loading: true, error: null });

  const load = useCallback(async (page, append) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await getAuditHistory(user.token, { entity, id, scope: scope || undefined, page, pageSize: PAGE_SIZE });
      setState((s) => ({
        logs: append ? [...s.logs, ...data.logs] : data.logs,
        page: data.currentPage,
        totalPages: data.totalPages,
        loading: false,
        error: null,
      }));
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.response?.data?.message || 'Failed to load history' }));
    }
  }, [user.token, entity, id, scope]);

  useEffect(() => {
    if (id) load(1, false);
  }, [load, id, refreshKey]);

  const groups = groupByBatch(state.logs);

  return (
    <div className="space-y-3">
      {scopes.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter history">
          {[{ key: '', label: 'All' }, ...scopes].map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setScope(s.key)}
              className={`text-xs px-2.5 py-1 rounded-full border cursor-pointer
                ${scope === s.key ? 'border-primary bg-primary-soft text-primary-soft-fg' : 'border-line text-muted hover:text-fg'}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      {!state.error && !state.loading && groups.length === 0 && (
        <p className="text-sm text-muted rounded-md border border-line bg-subtle p-3">
          Belum ada histori. Perubahan dicatat sejak fitur Audit Log aktif.
        </p>
      )}

      {groups.length > 0 && (
        <ol className="space-y-4">
          {groups.map((g) => <Group key={g.key} group={g} />)}
        </ol>
      )}

      {state.loading && <p className="text-sm text-muted">Loading...</p>}
      {!state.loading && state.page < state.totalPages && (
        <button
          type="button"
          onClick={() => load(state.page + 1, true)}
          className="w-full text-sm py-2 rounded border border-line hover:bg-subtle cursor-pointer"
        >
          Load more
        </button>
      )}
    </div>
  );
}
