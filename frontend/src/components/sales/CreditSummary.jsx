import { formatNumber, round2 } from '../../utils/formatHelper';
import { formatDay } from '../../utils/dateHelper';

/**
 * Posisi kredit customer (dari backend customerCredit):
 * { limit, receivable, uninvoiced, exposure, available, overdue: { count, amount, oldestDueDate } }.
 * `orderTotal` (opsional) = SO yang sedang dibuat, ditambahkan ke exposure untuk melihat sisa setelahnya.
 */
export default function CreditSummary({ credit, orderTotal = null, blockOverdue = true, className = '' }) {
  if (!credit) return null;
  const after = orderTotal === null ? credit.exposure : round2(credit.exposure + orderTotal);
  const over = credit.limit > 0 && after > credit.limit;
  const overdue = credit.overdue?.count > 0;
  const tone = over || (overdue && blockOverdue) ? 'border-danger bg-danger-soft' : 'border-line bg-subtle';
  const row = (label, value, strong = false) => (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={`tabular-nums ${strong ? 'font-semibold text-fg' : ''}`}>{value}</dd>
    </div>
  );
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${tone} ${className}`}>
      <div className="font-medium text-fg mb-1">
        <i className="fa fa-credit-card mr-1.5 text-muted"></i>Credit position
      </div>
      <dl className="space-y-0.5">
        {row('Credit limit', credit.limit > 0 ? formatNumber(credit.limit) : 'No limit')}
        {row('Unpaid invoices', formatNumber(credit.receivable))}
        {row('Orders not yet invoiced', formatNumber(credit.uninvoiced))}
        {orderTotal !== null && row('This order', formatNumber(orderTotal))}
        {row(orderTotal !== null ? 'Total after this order' : 'Total exposure', formatNumber(after), true)}
        {credit.limit > 0 && row('Available', formatNumber(round2(credit.limit - after)), true)}
      </dl>
      {over && <p className="mt-1.5 text-danger text-xs"><i className="fa fa-triangle-exclamation mr-1"></i>Melewati batas kredit: konfirmasi butuh persetujuan.</p>}
      {overdue && (
        <p className={`mt-1.5 text-xs ${blockOverdue ? 'text-danger' : 'text-muted'}`}>
          <i className="fa fa-clock mr-1"></i>
          {credit.overdue.count} invoice lewat jatuh tempo ({formatNumber(credit.overdue.amount)}, tertua {formatDay(credit.overdue.oldestDueDate)})
          {blockOverdue ? ': konfirmasi butuh persetujuan.' : '.'}
        </p>
      )}
    </div>
  );
}
