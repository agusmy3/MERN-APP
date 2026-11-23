import { STATUS_META } from '../../utils/stockMeta';

/**
 * Badge status dokumen: Draft / Posted / Cancelled (default: dokumen stok).
 * `meta` = peta status lain, mis. PO_STATUS_META dari utils/purchaseMeta.js.
 */
export default function StatusBadge({ status, meta = STATUS_META }) {
  const m = meta[status] || { label: status, tone: 'bg-subtle text-muted' };
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded whitespace-nowrap ${m.tone}`}>
      {m.icon && <i className={`fa ${m.icon} text-[10px]`}></i>}{m.label}
    </span>
  );
}
