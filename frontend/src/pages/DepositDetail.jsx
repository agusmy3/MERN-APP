import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import usePermission from '../hooks/usePermission';
import useToast from '../hooks/useToast';
import PageHeader from '../components/PageHeader';
import FormField from '../components/FormField';
import ReasonPanel from '../components/stock/ReasonPanel';
import AuditTimeline from '../components/audit/AuditTimeline';
import { inputClass } from '../utils/formStyles';
import { formatRupiah, round2 } from '../utils/formatHelper';
import { formatDate2, formatDay, toDateInput } from '../utils/dateHelper';
import { DEPOSIT_KINDS } from '../components/payment/depositConfig';
import { BATCH_METHODS, DEPOSIT_SOURCES, allocateFifo } from '../utils/paymentMeta';

const cellInput = `w-full bg-input text-fg border border-line rounded px-2 py-1 text-sm
  focus:outline-none focus:border-primary disabled:bg-transparent disabled:border-transparent`;
const btn = 'px-4 py-2 rounded text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
const btnGhost = `${btn} border border-line hover:bg-subtle`;
const btnPrimary = `${btn} bg-primary hover:bg-primary-hover text-primary-fg`;
const btnDanger = `${btn} border border-danger-line text-danger hover:bg-danger-soft`;
const th = 'px-2 py-2 border-b border-line font-semibold';
const td = 'px-2 py-1.5 border-t border-line-soft';
const methodLabel = (m) => (m === 'DEPOSIT' ? 'Deposit' : BATCH_METHODS[m] || m || '-');

/** Uang muka baru: pihak, tanggal, metode, jumlah, pesanan (opsional, info) */
function NewDeposit({ cfg, token, initialParty }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [parties, setParties] = useState([]);
  const [orders, setOrders] = useState([]);
  const [form, setForm] = useState({ party: initialParty || '', date: toDateInput(), method: 'TRANSFER', amount: '', order: '', reference: '', note: '' });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    cfg.loadParties(token).then(setParties).catch(console.error);
  }, [cfg, token]);
  useEffect(() => {
    setOrders([]);
    if (form.party) cfg.loadOrders(form.party, token).then(setOrders).catch(() => {});
  }, [cfg, form.party, token]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.party) return toast.warning(`Pilih ${cfg.partyLabel.toLowerCase()}.`);
    if (!(Number(form.amount) > 0)) return toast.warning('Isi jumlah lebih dari 0.');
    setBusy(true);
    try {
      const res = await cfg.create({
        [cfg.partyField]: form.party, date: form.date, method: form.method, amount: Number(form.amount),
        [cfg.orderField]: form.order || null, reference: form.reference, note: form.note,
      }, token);
      toast.success(res.data.message);
      navigate(`${cfg.basePath}/${res.data.data._id}`, { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save deposit');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-lg border border-line bg-surface p-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 max-w-5xl">
      <FormField label={cfg.partyLabel} htmlFor="dp-party" required>
        <select id="dp-party" value={form.party} onChange={(e) => setForm((f) => ({ ...f, party: e.target.value, order: '' }))} className={inputClass}>
          <option value="">— choose —</option>
          {parties.filter((p) => p.isActive !== false || p._id === form.party).map((p) => <option key={p._id} value={p._id}>{cfg.partyName(p)}</option>)}
        </select>
      </FormField>
      <FormField label="Date" htmlFor="dp-date" required>
        <input id="dp-date" type="date" max={toDateInput()} value={form.date} onChange={(e) => set('date', e.target.value)} className={inputClass} />
      </FormField>
      <FormField label="Method" htmlFor="dp-method" required>
        <select id="dp-method" value={form.method} onChange={(e) => set('method', e.target.value)} className={inputClass}>
          {Object.entries(BATCH_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </FormField>
      <FormField label="Amount" htmlFor="dp-amount" required>
        <input id="dp-amount" type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => set('amount', e.target.value)} className={`${inputClass} text-right tabular-nums`} />
      </FormField>
      <FormField label={`${cfg.orderLabel} (optional)`} htmlFor="dp-order" hint="Hanya catatan: uang muka untuk pesanan ini.">
        <select id="dp-order" value={form.order} disabled={!form.party} onChange={(e) => set('order', e.target.value)} className={inputClass}>
          <option value="">—</option>
          {orders.map((o) => <option key={o._id} value={o._id}>{o.no} · {formatRupiah(o.total)}</option>)}
        </select>
      </FormField>
      <FormField label="Reference" htmlFor="dp-ref">
        <input id="dp-ref" value={form.reference} maxLength={100} placeholder="No. bukti transfer / kuitansi" onChange={(e) => set('reference', e.target.value)} className={inputClass} />
      </FormField>
      <div className="sm:col-span-2">
        <FormField label="Note" htmlFor="dp-note">
          <input id="dp-note" value={form.note} maxLength={500} onChange={(e) => set('note', e.target.value)} className={inputClass} />
        </FormField>
      </div>
      <div className="sm:col-span-2 lg:col-span-4 flex justify-end">
        <button type="submit" disabled={busy} className={btnPrimary}><i className="fa fa-check"></i> Save deposit</button>
      </div>
    </form>
  );
}

/** Pakai saldo deposit untuk invoice / tagihan terbuka pihak yang sama (dibagi ke jatuh tempo tertua) */
function ApplyPanel({ cfg, doc, token, onDone, onClose }) {
  const toast = useToast();
  const [invoices, setInvoices] = useState(null);
  const [alloc, setAlloc] = useState({});
  const [date, setDate] = useState(toDateInput());
  const [busy, setBusy] = useState(false);
  const partyId = doc[cfg.partyField]?._id;

  useEffect(() => {
    cfg.openInvoices(partyId, token).then((rows) => {
      setInvoices(rows);
      setAlloc(allocateFifo(rows, doc.balance));
    }).catch((err) => toast.error(err.response?.data?.message || 'Failed to load invoices'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, partyId, token]);

  const total = round2(Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0));
  const submit = async () => {
    if (!(total > 0)) return toast.warning('Isi jumlah untuk minimal 1 tagihan.');
    if (total > doc.balance) return toast.warning(`Total melebihi saldo ${formatRupiah(doc.balance)}.`);
    const over = invoices.find((i) => Number(alloc[i._id] || 0) > i.balance);
    if (over) return toast.warning(`${over.no}: maksimal ${formatRupiah(over.balance)}.`);
    setBusy(true);
    try {
      const res = await cfg.apply(doc._id, {
        date, allocations: Object.entries(alloc).filter(([, v]) => Number(v) > 0).map(([invoice, v]) => ({ invoice, amount: Number(v) })),
      }, token);
      toast.success(res.data.message);
      await onDone();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to apply deposit');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-4 rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-line">
        <div>
          <h3 className="font-semibold text-fg">Use deposit for {cfg.invoiceLabel.toLowerCase()}s</h3>
          <p className="text-xs text-muted">Saldo {formatRupiah(doc.balance)} dibagi ke jatuh tempo tertua lebih dulu; ubah per baris bila perlu.</p>
        </div>
        <label className="text-xs text-muted flex items-center gap-2">Date
          <input type="date" max={toDateInput()} value={date} onChange={(e) => setDate(e.target.value)} className={`${inputClass} w-auto`} />
        </label>
      </div>
      {!invoices ? <p className="p-4 text-muted">Loading...</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: 560 }}>
            <thead className="bg-head text-head-fg text-left">
              <tr><th className={th}>{cfg.invoiceLabel}</th><th className={th}>Due</th><th className={`${th} text-right`}>Balance</th><th className={`${th} w-44 text-right`}>Use</th></tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i._id} className={Number(alloc[i._id]) > 0 ? 'bg-highlight' : 'hover:bg-subtle'}>
                  <td className={td}><Link to={`${cfg.invoicePath}/${i._id}`} className="font-mono text-xs font-semibold text-primary hover:underline">{i.no}</Link></td>
                  <td className={`${td} ${i.overdue ? 'text-danger font-semibold' : ''}`}>{i.dueDate ? formatDay(i.dueDate) : '-'}</td>
                  <td className={`${td} text-right tabular-nums`}>{formatRupiah(i.balance)}</td>
                  <td className={`${td} text-right`}>
                    <input aria-label={`Use for ${i.no}`} type="number" min="0" step="0.01" max={i.balance} value={alloc[i._id] ?? ''}
                      onChange={(e) => setAlloc((a) => ({ ...a, [i._id]: e.target.value }))} className={`${cellInput} text-right tabular-nums`} />
                  </td>
                </tr>
              ))}
              {!invoices.length && <tr><td colSpan={4} className="text-center py-6 text-muted">Tidak ada {cfg.invoiceLabel.toLowerCase()} yang belum lunas.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-end gap-3 px-4 py-3 border-t border-line text-sm">
        <span>Total <b className="tabular-nums">{formatRupiah(total)}</b> of {formatRupiah(doc.balance)}</span>
        <button type="button" onClick={onClose} className={btnGhost}>Close</button>
        <button type="button" onClick={submit} disabled={busy || !(total > 0)} className={btnPrimary}><i className="fa fa-check"></i> Apply</button>
      </div>
    </section>
  );
}

/** Kembalikan saldo deposit (uang keluar ke customer / masuk dari vendor) */
function RefundPanel({ cfg, doc, token, onDone, onClose }) {
  const toast = useToast();
  const [form, setForm] = useState({ date: toDateInput(), method: 'TRANSFER', amount: doc.balance, reference: '', note: '' });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async (e) => {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!(amount > 0) || amount > doc.balance) return toast.warning(`Isi jumlah 0 - ${formatRupiah(doc.balance)}.`);
    setBusy(true);
    try {
      const res = await cfg.refund(doc._id, { ...form, amount }, token);
      toast.success(res.data.message);
      await onDone();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to refund');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="mb-4 rounded-lg border border-line bg-surface p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5 max-w-5xl">
      <h3 className="sm:col-span-2 lg:col-span-5 font-semibold text-fg">Refund deposit <span className="text-xs font-normal text-muted">· {cfg.refundText}</span></h3>
      <label className="text-xs text-muted">Date<input type="date" max={toDateInput()} value={form.date} onChange={(e) => set('date', e.target.value)} className={inputClass} /></label>
      <label className="text-xs text-muted">Method
        <select value={form.method} onChange={(e) => set('method', e.target.value)} className={inputClass}>
          {Object.entries(BATCH_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className="text-xs text-muted">Amount<input type="number" min="0.01" step="0.01" max={doc.balance} value={form.amount} onChange={(e) => set('amount', e.target.value)} className={`${inputClass} text-right tabular-nums`} /></label>
      <label className="text-xs text-muted">Reference<input value={form.reference} maxLength={100} onChange={(e) => set('reference', e.target.value)} className={inputClass} /></label>
      <label className="text-xs text-muted">Note<input value={form.note} maxLength={500} onChange={(e) => set('note', e.target.value)} className={inputClass} /></label>
      <div className="sm:col-span-2 lg:col-span-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={btnGhost}>Close</button>
        <button type="submit" disabled={busy} className={btnPrimary}><i className="fa fa-arrow-rotate-left"></i> Refund</button>
      </div>
    </form>
  );
}

/** Deposit: kind = 'customer' | 'vendor'; /:id = 'new' (?customer= / ?vendor=) atau id dokumen */
export default function DepositDetail({ kind }) {
  const cfg = DEPOSIT_KINDS[kind];
  const { id } = useParams();
  const isNew = id === 'new';
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const perm = usePermission(cfg.resource);
  const toast = useToast();
  const [doc, setDoc] = useState(null);
  const [notFound, setNotFound] = useState(null);
  const [panel, setPanel] = useState(null); // apply | refund | cancel
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [refundCancel, setRefundCancel] = useState(null);
  const [refundReason, setRefundReason] = useState('');

  const load = useCallback(async () => {
    try {
      setDoc(await cfg.get(id, user.token));
      setVersion((v) => v + 1);
    } catch (err) {
      const s = err.response?.status;
      if ([400, 403, 404].includes(s)) setNotFound(err.response?.data?.message || 'Not found');
      else console.error(err);
    }
  }, [cfg, id, user.token]);

  useEffect(() => {
    if (!isNew) load();
  }, [isNew, load]);

  const done = async () => {
    setPanel(null);
    await load();
  };

  const cancel = async (reason) => {
    setBusy(true);
    try {
      const res = await cfg.cancel(id, reason, user.token);
      toast.success(res.data.message);
      await done();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to cancel');
    } finally {
      setBusy(false);
    }
  };
  const cancelRefund = async () => {
    if (!refundReason.trim()) return toast.warning('Isi alasan pembatalan.');
    setBusy(true);
    try {
      const res = await cfg.cancelRefund(id, refundCancel, refundReason.trim(), user.token);
      toast.success(res.data.message);
      setRefundCancel(null);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to cancel refund');
    } finally {
      setBusy(false);
    }
  };

  const usages = useMemo(() => doc?.usages || [], [doc]);

  if (isNew) {
    return (
      <div className="h-full p-4 flex flex-col overflow-auto">
        <PageHeader fallbackTitle={cfg.title} parentPath={cfg.basePath} title={cfg.newTitle} subtitle={cfg.subtitle} />
        {perm.loaded && !perm.canCreate
          ? <p className="text-muted">You don&apos;t have permission to record deposits.</p>
          : <NewDeposit cfg={cfg} token={user.token} initialParty={searchParams.get(cfg.partyField)} />}
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <p className="text-xl font-semibold text-fg mb-1">Deposit not available</p>
        <p className="text-muted mb-6">{notFound}</p>
        <Link to={cfg.basePath} className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded"><i className="fa fa-arrow-left"></i> Back</Link>
      </div>
    );
  }
  if (!doc) return <div className="p-6 text-muted">Loading...</div>;
  const posted = doc.status === 'POSTED';
  const canCancel = posted && perm.canUpdate && doc.source !== 'BATCH' && !(doc.usedAmount > 0) && !(doc.refundedAmount > 0);

  return (
    <div className="h-full p-4 flex flex-col overflow-auto">
      <PageHeader
        fallbackTitle={cfg.title}
        parentPath={cfg.basePath}
        title={doc.no}
        subtitle={`${cfg.partyName(doc[cfg.partyField])} · saldo ${formatRupiah(doc.balance)}`}
        actions={(
          <>
            {posted
              ? <span className="text-xs px-2 py-0.5 rounded bg-success-soft text-success-fg">Posted</span>
              : <span className="text-xs px-2 py-0.5 rounded bg-danger-soft text-danger">Cancelled</span>}
            {posted && perm.canCreate && doc.balance > 0 && (
              <>
                <button type="button" onClick={() => setPanel(panel === 'apply' ? null : 'apply')} className={btnPrimary}><i className="fa fa-file-invoice-dollar"></i> Use for {cfg.invoiceLabel.toLowerCase()}s</button>
                <button type="button" onClick={() => setPanel(panel === 'refund' ? null : 'refund')} className={btnGhost}><i className="fa fa-arrow-rotate-left"></i> Refund</button>
              </>
            )}
            {canCancel && (
              <button type="button" onClick={() => setPanel(panel === 'cancel' ? null : 'cancel')} disabled={busy} className={btnDanger}><i className="fa fa-ban"></i> Cancel</button>
            )}
          </>
        )}
      />
      {panel === 'apply' && <ApplyPanel cfg={cfg} doc={doc} token={user.token} onDone={done} onClose={() => setPanel(null)} />}
      {panel === 'refund' && <RefundPanel cfg={cfg} doc={doc} token={user.token} onDone={done} onClose={() => setPanel(null)} />}
      {panel === 'cancel' && (
        <ReasonPanel title={`Cancel ${doc.no}`} confirmLabel="Cancel deposit" busy={busy} onConfirm={cancel} onClose={() => setPanel(null)}
          description={doc.source === 'OVERPAYMENT' ? `Kelebihan bayar ${doc[cfg.invoiceField]?.no || ''} kembali ke ${cfg.invoiceLabel.toLowerCase()}-nya.` : 'Deposit dibatalkan (hanya bila belum dipakai & belum dikembalikan).'} />
      )}

      <div className="grid gap-4 items-start xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4 min-w-0">
          <section className="rounded-lg border border-line bg-surface p-4 grid gap-3 grid-cols-2 sm:grid-cols-4 text-sm">
            {[['Amount', doc.amount], ['Used', doc.usedAmount], ['Refunded', doc.refundedAmount], ['Balance', doc.balance]].map(([label, v]) => (
              <div key={label}>
                <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
                <div className={`text-lg font-semibold tabular-nums ${label === 'Balance' && v > 0 ? 'text-primary' : 'text-fg'}`}>{formatRupiah(v || 0)}</div>
              </div>
            ))}
          </section>

          <section className="rounded-lg border border-line bg-surface min-w-0">
            <div className="px-4 py-3 border-b border-line"><h3 className="font-semibold text-fg">Used for ({usages.filter((u) => u.type === 'PAYMENT').length})</h3></div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: 560 }}>
                <thead className="bg-head text-head-fg text-left">
                  <tr><th className={th}>Payment</th><th className={th}>Date</th><th className={th}>{cfg.invoiceLabel}</th><th className={`${th} text-right`}>Amount</th><th className={th}>Status</th></tr>
                </thead>
                <tbody>
                  {usages.map((u) => {
                    const inv = u[cfg.invoiceField] || {};
                    const cancelled = u.status === 'CANCELLED';
                    return (
                      <tr key={u._id} className={cancelled ? 'opacity-60' : 'hover:bg-subtle'}>
                        <td className={`${td} font-mono text-xs`}>{u.no}{u.type === 'REFUND' && <span className="ml-1 text-muted">(kelebihan bayar masuk)</span>}</td>
                        <td className={td}>{formatDay(u.date)}</td>
                        <td className={td}>{inv._id ? <Link to={`${cfg.invoicePath}/${inv._id}`} className="font-mono text-xs font-semibold text-primary hover:underline">{inv.no}</Link> : inv.no}</td>
                        <td className={`${td} text-right tabular-nums ${cancelled ? 'line-through' : ''}`}>{u.type === 'REFUND' ? '+' : '−'}{formatRupiah(u.amount)}</td>
                        <td className={td}>{cancelled ? <span className="text-danger" title={u.cancelReason}>cancelled</span> : u.batch ? <Link to={`${cfg.batchPath}/${u.batch}`} className="text-primary hover:underline">combined</Link> : 'posted'}</td>
                      </tr>
                    );
                  })}
                  {!usages.length && <tr><td colSpan={5} className="text-center py-6 text-muted">Belum dipakai.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          {(doc.refunds || []).length > 0 && (
            <section className="rounded-lg border border-line bg-surface p-4 text-sm">
              <h3 className="font-semibold text-fg mb-2">Refunds</h3>
              <ul className="divide-y divide-line-soft">
                {doc.refunds.map((r) => {
                  const cancelled = r.status === 'CANCELLED';
                  return (
                    <li key={r._id} className={`py-1.5 ${cancelled ? 'opacity-60' : ''}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span>{formatDay(r.date)} · {methodLabel(r.method)}{r.reference ? ` · ${r.reference}` : ''}{r.note ? ` · ${r.note}` : ''}</span>
                        <span className={`tabular-nums ${cancelled ? 'line-through' : ''}`}>{formatRupiah(r.amount)}</span>
                      </div>
                      <div className="flex justify-end text-xs text-muted">
                        {cancelled ? <span className="text-danger" title={r.cancelReason}>cancelled</span>
                          : posted && perm.canUpdate && refundCancel !== r._id && (
                            <button type="button" onClick={() => { setRefundCancel(r._id); setRefundReason(''); }} className="hover:text-danger cursor-pointer">cancel</button>
                          )}
                      </div>
                      {refundCancel === r._id && (
                        <div className="mt-1.5 flex gap-2">
                          <input value={refundReason} autoFocus placeholder="Alasan pembatalan" onChange={(e) => setRefundReason(e.target.value)} className={`${inputClass} py-1`} />
                          <button type="button" onClick={cancelRefund} disabled={busy} className="px-3 py-1.5 rounded text-sm border border-danger-line text-danger hover:bg-danger-soft cursor-pointer">OK</button>
                          <button type="button" onClick={() => setRefundCancel(null)} className="px-3 py-1.5 rounded text-sm border border-line cursor-pointer">×</button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>

        <aside className="space-y-4 min-w-0">
          <section className="rounded-lg border border-line bg-surface p-4 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
              <dt className="text-muted">{cfg.partyLabel}</dt><dd>{cfg.partyName(doc[cfg.partyField])}</dd>
              <dt className="text-muted">Date</dt><dd>{formatDay(doc.date)}</dd>
              <dt className="text-muted">Source</dt>
              <dd>
                {DEPOSIT_SOURCES[doc.source] || doc.source}
                {doc.batch && <> · <Link to={`${cfg.batchPath}/${doc.batch._id}`} className="text-primary hover:underline">{doc.batch.no}</Link></>}
                {doc[cfg.invoiceField] && <> · <Link to={`${cfg.invoicePath}/${doc[cfg.invoiceField]._id}`} className="text-primary hover:underline">{doc[cfg.invoiceField].no}</Link></>}
              </dd>
              {doc.method && (<><dt className="text-muted">Method</dt><dd>{methodLabel(doc.method)}</dd></>)}
              {doc[cfg.orderField] && (<><dt className="text-muted">{cfg.orderLabel}</dt><dd><Link to={`${cfg.orderPath}/${doc[cfg.orderField]._id}`} className="text-primary hover:underline">{doc[cfg.orderField].no}</Link></dd></>)}
              {doc.reference && (<><dt className="text-muted">Reference</dt><dd>{doc.reference}</dd></>)}
              {doc.note && (<><dt className="text-muted">Note</dt><dd className="break-words">{doc.note}</dd></>)}
              <dt className="text-muted">Recorded</dt><dd>{formatDate2(doc.createdDate)} · {doc.createdBy?.name || '-'}</dd>
              {doc.cancelledDate && (<><dt className="text-muted">Cancelled</dt><dd>{formatDate2(doc.cancelledDate)} · {doc.cancelledBy?.name || '-'}<div className="text-xs">{doc.cancelReason}</div></dd></>)}
            </dl>
          </section>
          <section className="rounded-lg border border-line bg-surface p-4">
            <h3 className="font-semibold text-fg mb-2">History</h3>
            <AuditTimeline entity={cfg.auditEntity} id={doc._id} refreshKey={version} />
          </section>
        </aside>
      </div>
    </div>
  );
}
