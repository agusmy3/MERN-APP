import { useState } from 'react';
import AuditTimeline from './AuditTimeline';

/**
 * Bagian "History" yang bisa dibuka-tutup di drawer (dimuat hanya saat dibuka).
 * Pasang lewat prop `aside` FormDrawer (di luar <fieldset disabled>, supaya tetap bisa diklik di mode Detail).
 */
export default function AuditHistorySection({ entity, id, scopes }) {
  const [open, setOpen] = useState(false);
  if (!id) return null;

  return (
    <div className="rounded border border-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold text-fg hover:bg-subtle cursor-pointer"
      >
        <span><i className="fa fa-clock-rotate-left mr-1.5 text-muted"></i>History</span>
        <i className={`fa fa-chevron-${open ? 'up' : 'down'} text-xs text-muted`}></i>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-line">
          <AuditTimeline entity={entity} id={id} scopes={scopes} />
        </div>
      )}
    </div>
  );
}
