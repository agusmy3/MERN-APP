import { useState } from 'react';
import { Link } from 'react-router-dom';
import { createSalesPayment, cancelSalesPayment } from '../../services/salesService';
import usePermission from '../../hooks/usePermission';
import useToast from '../../hooks/useToast';
import { inputClass } from '../../utils/formStyles';
import { formatRupiah } from '../../utils/formatHelper';
import { formatDay, toDateInput } from '../../utils/dateHelper';
import { PAYMENT_METHODS } from '../../utils/salesMeta';

const btn = 'px-3 py-1.5 rounded text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

/**
 * Pembayaran & refund di halaman invoice / tagihan POSTED: daftar, catat baru (default = sisa tagihan / kelebihan
 * bayar), batalkan dengan alasan. Default = invoice penjualan (izin salesPayment); tagihan vendor memakai
 * resource 'vendorPayment', invoiceKey 'purchaseInvoice', createFn / cancelFn & methods sendiri.
 */
export default function InvoicePayments({
  doc, token, onChanged, resource = 'salesPayment', invoiceKey = 'salesInvoice',
  createFn = createSalesPayment, cancelFn = cancelSalesPayment, methods = PAYMENT_METHODS,
  refundText = 'dikembalikan ke customer', batchPath = '/customer-receipt',
}) {
  const perm = usePermission(resource);
  const toast = useToast();
  const refund = doc.balance < 0;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cancelId, setCancelId] = useState(null);
  const [cancelReason, setCancelReason] = useState('');

  if (!perm.canView) return null;
  const payments = doc.payments || [];
  const canRecord = perm.canCreate && doc.balance !== 0;

  const start = () => {
    setForm({ date: toDateInput(), method: refund ? 'CASH' : 'TRANSFER', amount: Math.abs(doc.balance), reference: '', note: '' });
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!(amount > 0)) return toast.warning('Isi jumlah lebih dari 0.');
    if (amount > Math.abs(doc.balance)) return toast.warning(`Maksimal ${formatRupiah(Math.abs(doc.balance))}.`);
    setBusy(true);
    try {
      const res = await createFn({ ...form, amount, [invoiceKey]: doc._id, type: refund ? 'REFUND' : 'PAYMENT' }, token);
      toast.success(res.data.message);
      setOpen(false);
      await onChanged();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to record payment');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!cancelReason.trim()) return toast.warning('Isi alasan pembatalan.');
    setBusy(true);
    try {
      const res = await cancelFn(cancelId, cancelReason.trim(), token);
      toast.success(res.data.message);
      setCancelId(null);
      setCancelReason('');
      await onChanged();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to cancel payment');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-line bg-surface p-4 text-sm">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="font-semibold text-fg">Payments</h3>
        {canRecord && !open && (
          <button type="button" onClick={start} className={`${btn} bg-primary hover:bg-primary-hover text-primary-fg`}>
            <i className={`fa ${refund ? 'fa-arrow-rotate-left' : 'fa-plus'}`}></i> {refund ? 'Refund' : 'Record payment'}
          </button>
        )}
      </div>

      {open && form && (
        <form onSubmit={submit} className="mb-3 p-3 rounded border border-line bg-subtle space-y-2">
          <div className="text-xs text-muted">
            {refund ? `Kelebihan bayar ${formatRupiah(-doc.balance)} ${refundText}.` : `Sisa tagihan ${formatRupiah(doc.balance)}.`}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted">Date
              <input type="date" max={toDateInput()} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className={inputClass} />
            </label>
            <label className="text-xs text-muted">Method
              <select value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))} className={inputClass}>
                {Object.entries(methods).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </div>
          <label className="block text-xs text-muted">Amount
            <input type="number" min="0.01" step="0.01" max={Math.abs(doc.balance)} value={form.amount} autoFocus
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} className={`${inputClass} text-right tabular-nums`} />
          </label>
          <label className="block text-xs text-muted">Reference
            <input value={form.reference} maxLength={100} placeholder="No. bukti transfer / kuitansi" onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} className={inputClass} />
          </label>
          <label className="block text-xs text-muted">Note
            <input value={form.note} maxLength={500} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className={inputClass} />
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} disabled={busy} className={`${btn} border border-line hover:bg-surface`}>Cancel</button>
            <button type="submit" disabled={busy} className={`${btn} bg-primary hover:bg-primary-hover text-primary-fg`}>Save</button>
          </div>
        </form>
      )}

      {payments.length === 0 ? (
        <p className="text-muted text-xs">Belum ada pembayaran.</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {payments.map((p) => {
            const cancelled = p.status === 'CANCELLED';
            return (
              <li key={p._id} className={`py-1.5 ${cancelled ? 'opacity-60' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold">{p.no}</span>
                  <span className={`tabular-nums ${cancelled ? 'line-through' : ''} ${p.type === 'REFUND' ? 'text-danger' : ''}`}>
                    {p.type === 'REFUND' ? '−' : ''}{formatRupiah(p.amount)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-muted">
                  <span>{formatDay(p.date)} · {methods[p.method] || p.method}{p.type === 'REFUND' ? ' · refund' : ''}{p.reference ? ` · ${p.reference}` : ''}</span>
                  {cancelled ? <span className="text-danger" title={p.cancelReason}>cancelled</span>
                    : p.batch ? <Link to={`${batchPath}/${p.batch._id || p.batch}`} className="text-primary hover:underline" title="Bagian dari pembayaran gabungan">via {p.batch.no || 'batch'}</Link>
                    : perm.canUpdate && cancelId !== p._id && (
                      <button type="button" onClick={() => { setCancelId(p._id); setCancelReason(''); }} className="hover:text-danger cursor-pointer">cancel</button>
                    )}
                </div>
                {cancelId === p._id && (
                  <div className="mt-1.5 flex gap-2">
                    <input value={cancelReason} autoFocus placeholder="Alasan pembatalan" onChange={(e) => setCancelReason(e.target.value)} className={`${inputClass} py-1`} />
                    <button type="button" onClick={cancel} disabled={busy} className={`${btn} border border-danger-line text-danger hover:bg-danger-soft`}>OK</button>
                    <button type="button" onClick={() => setCancelId(null)} disabled={busy} className={`${btn} border border-line`}>×</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
