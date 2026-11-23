import { STATUS_META } from '../../utils/stockMeta';

/** Badge status dokumen stok: Draft / Posted / Cancelled */
export default function StatusBadge({ status }) {
  const m = STATUS_META[status] || { label: status, tone: 'bg-subtle text-muted' };
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded whitespace-nowrap ${m.tone}`}>
      {m.icon && <i className={`fa ${m.icon} text-[10px]`}></i>}{m.label}
    </span>
  );
}
