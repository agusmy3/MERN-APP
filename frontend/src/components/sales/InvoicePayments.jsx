import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  createSalesPayment, cancelSalesPayment, getOpenCustomerDeposits, customerDepositFromInvoice,
} from '../../services/salesService';
import usePermission from '../../hooks/usePermission';
import useToast from '../../hooks/useToast';
import { inputClass } from '../../utils/formStyles';
import { formatRupiah, round2 } from '../../utils/formatHelper';
import { formatDay, toDateInput } from '../../utils/dateHelper';
import { PAYMENT_METHODS } from '../../utils/salesMeta';
import { WRITE_OFF_REASONS, writeOffLabel } from '../../utils/paymentMeta';

const btn = 'px-3 py-1.5 rounded text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

/**
 * Pembayaran & refund di halaman invoice / tagihan POSTED: daftar, catat baru (default = sisa tagihan / kelebihan
 * bayar), batalkan dengan alasan. Pembayaran bisa dari saldo deposit (metode Deposit) dan diberi potongan (write-off);
 * kelebihan bayar bisa dikembalikan (refund) atau dipindah ke deposit. Default = invoice penjualan (izin salesPayment);
 * tagihan vendor memakai side 'purchase', resource 'vendorPayment', invoiceKey 'purchaseInvoice', fungsi & methods sendiri.
 */
export default function InvoicePayments({
  doc, token, onChanged, resource = 'salesPayment', invoiceKey = 'salesInvoice',
  createFn = createSalesPayment, cancelFn = cancelSalesPayment, methods = PAYMENT_METHODS,
  refundText = 'dikembalikan ke customer', batchPath = '/customer-receipt',
  side = 'sales', partyId = doc.customer?._id || doc.customer, openDepositsFn = getOpenCustomerDeposits,
  fromInvoiceFn = customerDepositFromInvoice, depositPath = '/customer-deposit',
}) {
  const perm = usePermission(resource);
  const toast = useToast();
  const refund = doc.balance < 0;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(null);
  const [deposits, setDeposits] = useState([]);
  const [busy, setBusy] = useState(false);
  const [cancelId, setCancelId] = useState(null);
  const [cancelReason, setCancelReason] = useState('');

  if (!perm.canView) return null;
  const payments = doc.payments || [];
  const canRecord = perm.canCreate && doc.balance !== 0;
  const reasons = WRITE_OFF_REASONS[side];
  const methodLabel = (m) => (m === 'DEPOSIT' ? 'Deposit' : methods[m] || m || 'Potongan');

  const start = async () => {
    setForm({
      date: toDateInput(), method: refund ? 'CASH' : 'TRANSFER', amount: Math.abs(doc.balance), deposit: '',
      writeOffAmount: '', writeOffReason: Object.keys(reasons)[0], reference: '', note: '',
    });
    setOpen(true);
    setDeposits([]);
    if (!refund && partyId && openDepositsFn) {
      try {
        setDeposits(await openDepositsFn(partyId, token));
      } catch {
        // daftar deposit hanya pelengkap
      }
    }
  };
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const amount = round2(Number(form?.amount) || 0);
  const writeOff = refund ? 0 : round2(Number(form?.writeOffAmount) || 0);
  const chosenDeposit = deposits.find((d) => d._id === form?.deposit);

  const submit = async (e) => {
    e.preventDefault();
    if (!(amount > 0) && !(writeOff > 0)) return toast.warning('Isi jumlah lebih dari 0.');
    if (round2(amount + writeOff) > Math.abs(doc.balance)) return toast.warning(`Bayar + potongan maksimal ${formatRupiah(Math.abs(doc.balance))}.`);
    if (amount > 0 && form.method === 'DEPOSIT') {
      if (!chosenDeposit) return toast.warning('Pilih deposit yang dipakai.');
      if (amount > chosenDeposit.balance) return toast.warning(`Saldo ${chosenDeposit.no} hanya ${formatRupiah(chosenDeposit.balance)}.`);
    }
    if (writeOff > 0 && side === 'purchase' && form.writeOffReason === 'OTHER' && !form.note.trim()) return toast.warning('Isi catatan untuk potongan "Lainnya".');
    setBusy(true);
    try {
      const payload = {
        [invoiceKey]: doc._id, type: refund ? 'REFUND' : 'PAYMENT', date: form.date, method: form.method, amount,
        deposit: form.method === 'DEPOSIT' ? form.deposit : undefined, reference: form.reference, note: form.note,
        ...(writeOff > 0 ? { writeOffAmount: writeOff, writeOffReason: form.writeOffReason } : {}),
      };
      const res = await createFn(payload, token);
      toast.success(res.data.message);
      setOpen(false);
      await onChanged();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to record payment');
    } finally {
      setBusy(false);
    }
  };

  const toDeposit = async () => {
    setBusy(true);
    try {
      const res = await fromInvoiceFn({ [invoiceKey]: doc._id, amount, date: form.date, note: form.note }, token);
      toast.success(res.data.message);
      setOpen(false);
      await onChanged();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to move to deposit');
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
            {refund ? `Kelebihan bayar ${formatRupiah(-doc.balance)}: ${refundText}, atau simpan sebagai deposit.` : `Sisa tagihan ${formatRupiah(doc.balance)}.`}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted">Date
              <input type="date" max={toDateInput()} value={form.date} onChange={(e) => set('date', e.target.value)} className={inputClass} />
            </label>
            <label className="text-xs text-muted">Method
              <select value={form.method} onChange={(e) => set('method', e.target.value)} className={inputClass}>
                {Object.entries(methods).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                {!refund && deposits.length > 0 && <option value="DEPOSIT">Deposit</option>}
              </select>
            </label>
          </div>
          {form.method === 'DEPOSIT' && (
            <label className="block text-xs text-muted">Deposit
              <select value={form.deposit} onChange={(e) => {
                const d = deposits.find((x) => x._id === e.target.value);
                setForm((f) => ({ ...f, deposit: e.target.value, amount: d ? Math.min(d.balance, Math.abs(doc.balance)) : f.amount }));
              }} className={inputClass}>
                <option value="">— pilih deposit —</option>
                {deposits.map((d) => <option key={d._id} value={d._id}>{d.no} · saldo {formatRupiah(d.balance)}</option>)}
              </select>
            </label>
          )}
          <label className="block text-xs text-muted">Amount
            <input type="number" min="0" step="0.01" max={Math.abs(doc.balance)} value={form.amount} autoFocus
              onChange={(e) => set('amount', e.target.value)} className={`${inputClass} text-right tabular-nums`} />
          </label>
          {!refund && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-muted">Write-off
                <input type="number" min="0" step="0.01" value={form.writeOffAmount} placeholder="0"
                  onChange={(e) => set('writeOffAmount', e.target.value)} className={`${inputClass} text-right tabular-nums`} />
              </label>
              <label className="text-xs text-muted">Reason
                <select value={form.writeOffReason} disabled={!(writeOff > 0)} onChange={(e) => set('writeOffReason', e.target.value)} className={inputClass}>
                  {Object.entries(reasons).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              {amount > 0 && round2(Math.abs(doc.balance) - amount) > 0 && (
                <button type="button" onClick={() => set('writeOffAmount', round2(Math.abs(doc.balance) - amount))}
                  className="col-span-2 text-left text-xs text-primary hover:underline cursor-pointer">
                  Sisanya ({formatRupiah(round2(Math.abs(doc.balance) - amount))}) jadikan potongan
                </button>
              )}
              <p className="col-span-2 text-xs text-muted">Potongan mengurangi sisa tagihan tanpa uang (bukan pengurang penjualan). Di atas batas setting butuh persetujuan.</p>
            </div>
          )}
          <label className="block text-xs text-muted">Reference
            <input value={form.reference} maxLength={100} placeholder="No. bukti transfer / kuitansi" onChange={(e) => set('reference', e.target.value)} className={inputClass} />
          </label>
          <label className="block text-xs text-muted">Note
            <input value={form.note} maxLength={500} onChange={(e) => set('note', e.target.value)} className={inputClass} />
          </label>
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} disabled={busy} className={`${btn} border border-line hover:bg-surface`}>Cancel</button>
            {refund && fromInvoiceFn && (
              <button type="button" onClick={toDeposit} disabled={busy || !(amount > 0)} className={`${btn} border border-line hover:bg-surface`}>
                <i className="fa fa-piggy-bank"></i> Move to deposit
              </button>
            )}
            <button type="submit" disabled={busy} className={`${btn} bg-primary hover:bg-primary-hover text-primary-fg`}>{refund ? 'Refund' : 'Save'}</button>
          </div>
        </form>
      )}

      {payments.length === 0 ? (
        <p className="text-muted text-xs">Belum ada pembayaran.</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {payments.map((p) => {
            const cancelled = p.status === 'CANCELLED';
            const viaDeposit = p.method === 'DEPOSIT' && p.deposit;
            return (
              <li key={p._id} className={`py-1.5 ${cancelled ? 'opacity-60' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold">{p.no}</span>
                  <span className={`tabular-nums ${cancelled ? 'line-through' : ''} ${p.type === 'REFUND' ? 'text-danger' : ''}`}>
                    {p.type === 'REFUND' ? '−' : ''}{formatRupiah(p.amount)}
                  </span>
                </div>
                {p.writeOffAmount > 0 && (
                  <div className={`flex items-center justify-between gap-2 text-xs ${cancelled ? 'line-through' : ''}`}>
                    <span className="text-muted">Potongan · {writeOffLabel(p.writeOffReason)}</span>
                    <span className="tabular-nums text-warning-fg">{formatRupiah(p.writeOffAmount)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 text-xs text-muted">
                  <span>
                    {formatDay(p.date)} · {p.amount > 0 ? methodLabel(p.method) : 'Potongan saja'}
                    {viaDeposit && <> <Link to={`${depositPath}/${p.deposit._id || p.deposit}`} className="text-primary hover:underline">{p.deposit.no || 'deposit'}</Link></>}
                    {p.type === 'REFUND' ? (p.method === 'DEPOSIT' ? ' · ke deposit' : ' · refund') : ''}{p.reference ? ` · ${p.reference}` : ''}
                  </span>
                  {cancelled ? <span className="text-danger" title={p.cancelReason}>cancelled</span>
                    : p.batch ? <Link to={`${batchPath}/${p.batch._id || p.batch}`} className="text-primary hover:underline" title="Bagian dari pembayaran gabungan">via {p.batch.no || 'batch'}</Link>
                    : p.type === 'REFUND' && p.method === 'DEPOSIT' ? <span title="Batalkan lewat deposit-nya">via deposit</span>
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
