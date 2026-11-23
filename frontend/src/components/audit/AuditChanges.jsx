import { ACTION_META, ENTITY_META, LOGIN_REASON, formatAuditValue, listDiff } from '../../utils/auditFormat';

const Empty = () => <span className="text-muted italic">empty</span>;

/** Badge aksi: Created / Updated / Deleted / Login / Login failed */
export function ActionBadge({ action }) {
  const meta = ACTION_META[action] || { label: action, icon: 'fa-circle', tone: 'bg-subtle text-muted' };
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded ${meta.tone}`}>
      <i className={`fa ${meta.icon}`}></i>{meta.label}
    </span>
  );
}

/**
 * Isi 1 log: daftar field yang berubah (lama -> baru).
 * create: hanya nilai baru · delete: nilai terakhir (dicoret) · login: alasan & perangkat.
 */
export default function AuditChanges({ log, showEntity = true }) {
  const entity = ENTITY_META[log.entity] || { label: log.entity, icon: 'fa-circle' };

  return (
    <div className="min-w-0">
      {showEntity && (
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <i className={`fa ${entity.icon} text-muted text-xs`}></i>
          <span className="text-muted">{entity.label}</span>
          <span className="font-medium text-fg break-all">{log.entityLabel || '-'}</span>
        </div>
      )}

      {(log.action === 'login' || log.action === 'login_failed') && (
        <div className="text-xs text-muted mt-0.5 space-y-0.5">
          {log.meta?.reason && <div className="text-warning-fg">{LOGIN_REASON[log.meta.reason] || log.meta.reason}</div>}
          <div>IP {log.ip || '-'}</div>
          {log.meta?.userAgent && <div className="truncate" title={log.meta.userAgent}>{log.meta.userAgent}</div>}
        </div>
      )}

      {log.changes?.length > 0 && (
        <dl className="mt-1 grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-3 gap-y-0.5 text-xs">
          {log.changes.map((c) => {
            const from = formatAuditValue(c, c.from);
            const to = formatAuditValue(c, c.to);
            return (
              <div key={c.field} className="contents">
                <dt className="text-muted truncate" title={c.label || c.field}>{c.label || c.field}</dt>
                <dd className="text-fg min-w-0 break-words">
                  {c.format === 'secret' ? (
                    <span className="italic text-muted">{log.action === 'create' ? 'set' : 'changed'}</span>
                  ) : log.action === 'create' ? (
                    to ?? <Empty />
                  ) : log.action === 'update' && c.format === 'list' ? (
                    // daftar: tampilkan yang ditambah / dihapus saja
                    <span className="inline-flex flex-wrap gap-1">
                      {listDiff(c.from, c.to).added.map((v) => (
                        <span key={`+${v}`} className="px-1.5 rounded bg-success-soft text-success-fg">+ {v}</span>
                      ))}
                      {listDiff(c.from, c.to).removed.map((v) => (
                        <span key={`-${v}`} className="px-1.5 rounded bg-danger-soft text-danger line-through">{v}</span>
                      ))}
                    </span>
                  ) : log.action === 'delete' ? (
                    <span className="line-through text-muted">{from ?? '-'}</span>
                  ) : (
                    <>
                      <span className="text-muted">{from ?? <Empty />}</span>
                      <i className="fa fa-arrow-right-long mx-1.5 text-muted text-[10px]"></i>
                      <span className="font-medium">{to ?? <Empty />}</span>
                    </>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </div>
  );
}
