import { useState } from 'react';

/**
 * Panel konfirmasi aksi dokumen yang butuh alasan (Cancel / Close). Alasan wajib diisi.
 * onConfirm(reason) -> Promise; panel ditutup oleh pemanggil (onClose) setelah berhasil.
 */
export default function ReasonPanel({ title, description, placeholder = 'Alasan (wajib)', confirmLabel, icon = 'fa-ban', busy, onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  return (
    <section className="mb-4 rounded-lg border border-danger-line bg-danger-soft p-4 space-y-3 max-w-3xl">
      <div>
        <h3 className="font-semibold text-danger">{title}</h3>
        {description && <p className="text-sm text-fg">{description}</p>}
      </div>
      <textarea
        aria-label={placeholder}
        rows={2}
        placeholder={placeholder}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="w-full bg-surface text-fg border border-line rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
        autoFocus
      />
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onClose} className="px-4 py-2 rounded text-sm border border-line hover:bg-subtle cursor-pointer">
          Close
        </button>
        <button
          type="button"
          onClick={() => onConfirm(reason.trim())}
          disabled={busy || !reason.trim()}
          className="px-4 py-2 rounded text-sm bg-danger text-danger-fg hover:opacity-90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <i className={`fa ${icon}`}></i> {confirmLabel}
        </button>
      </div>
    </section>
  );
}
