import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getSettings } from '../services/purchaseService';
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
import { BATCH_KINDS } from '../components/payment/batchConfig';
import { BATCH_METHODS, allocateFifo } from '../utils/paymentMeta';
import { printPaymentBatch } from '../utils/documentPrint';

const cellInput = `w-full bg-input text-fg border border-line rounded px-2 py-1 text-sm
  focus:outline-none focus:border-primary disabled:bg-transparent disabled:border-transparent`;
const btn = 'px-4 py-2 rounded text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
const btnGhost = `${btn} border border-line hover:bg-subtle`;
const btnPrimary = `${btn} bg-primary hover:bg-primary-hover text-primary-fg`;
const btnDanger = `${btn} border border-danger-line text-danger hover:bg-danger-soft`;
const th = 'px-2 py-2 border-b border-line font-semibold';
const td = 'px-2 py-1.5 border-t border-line-soft';

/** Form pembayaran baru: pilih pihak, isi jumlah, bagi otomatis ke invoice tertua (bisa diubah per invoice) */
function NewBatch({ cfg, token, initialParty }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [parties, setParties] = useState([]);
  const [party, setParty] = useState(initialParty || '');
  const [invoices, setInvoices] = useState(null);
  const [alloc, setAlloc] = useState({});
  const [form, setForm] = useState({ date: toDateInput(), method: 'TRANSFER', amount: '', reference: '', note: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    cfg.loadParties(token).then(setParties).catch(console.error);
  }, [cfg, token]);
  useEffect(() => {
    setInvoices(null);
    setAlloc({});
    if (!party) return;
    cfg.openInvoices(party, token).then(setInvoices).catch((err) => toast.error(err.response?.data?.message || 'Failed to load invoices'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, party, token]);

  const outstanding = useMemo(() => round2((invoices || []).reduce((s, i) => s + i.balance, 0)), [invoices]);
  const allocated = round2(Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0));
  const amount = round2(Number(form.amount) || 0);
  const diff = round2(amount - allocated);

  const changeAmount = (value) => {
    setForm((f) => ({ ...f, amount: value }));
    setAlloc(allocateFifo(invoices || [], value));
  };

  const submit = async () => {
    if (!party) return toast.warning(`Pilih ${cfg.partyLabel.toLowerCase()}.`);
    if (!(amount > 0)) return toast.warning('Isi jumlah lebih dari 0.');
    if (amount > outstanding) return toast.warning(`Jumlah melebihi total sisa ${formatRupiah(outstanding)} (kelebihan bayar belum didukung).`);
    const over = (invoices || []).find((i) => Number(alloc[i._id] || 0) > i.balance);
    if (over) return toast.warning(`${over.no}: maksimal ${formatRupiah(over.balance)}.`);
    if (diff !== 0) return toast.warning(`Total alokasi ${formatRupiah(allocated)} harus sama dengan jumlah ${formatRupiah(amount)}.`);
    setBusy(true);
    try {
      const res = await cfg.create({
        [cfg.partyField]: party, ...form, amount,
        allocations: Object.entries(alloc).filter(([, v]) => Number(v) > 0).map(([invoice, v]) => ({ invoice, amount: Number(v) })),
      }, token);
      toast.success(res.data.message);
      navigate(`${cfg.basePath}/${res.data.data._id}`, { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save payment');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 w-full">
      <section className="rounded-lg border border-line bg-surface p-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label={cfg.partyLabel} htmlFor="pb-party" required>
          <select id="pb-party" value={party} onChange={(e) => setParty(e.target.value)} className={inputClass}>
            <option value="">— choose —</option>
            {parties.filter((p) => p.isActive !== false || p._id === party).map((p) => <option key={p._id} value={p._id}>{cfg.partyName(p)}</option>)}
          </select>
        </FormField>
        <FormField label="Date" htmlFor="pb-date" required>
          <input id="pb-date" type="date" max={toDateInput()} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className={inputClass} />
        </FormField>
        <FormField label="Method" htmlFor="pb-method" required>
          <select id="pb-method" value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))} className={inputClass}>
            {Object.entries(BATCH_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </FormField>
        <FormField label="Amount" htmlFor="pb-amount" required hint={invoices ? `Total sisa: ${formatRupiah(outstanding)}` : undefined}>
          <input id="pb-amount" type="number" min="0.01" step="0.01" value={form.amount} disabled={!invoices?.length}
            onChange={(e) => changeAmount(e.target.value)} className={`${inputClass} text-right tabular-nums`} />
        </FormField>
        <FormField label="Reference" htmlFor="pb-ref">
          <input id="pb-ref" value={form.reference} maxLength={100} placeholder="No. bukti transfer / kuitansi"
            onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} className={inputClass} />
        </FormField>
        <div className="sm:col-span-1 lg:col-span-3">
          <FormField label="Note" htmlFor="pb-note">
            <input id="pb-note" value={form.note} maxLength={500} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className={inputClass} />
          </FormField>
        </div>
      </section>

      {party && !invoices && <p className="text-muted">Loading...</p>}
      {invoices && (
        <section className="rounded-lg border border-line bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-line">
            <div>
              <h3 className="font-semibold text-fg">Open {cfg.invoiceLabel.toLowerCase()}s ({invoices.length})</h3>
              <p className="text-xs text-muted">Jumlah dibagi otomatis ke jatuh tempo tertua lebih dulu; ubah per baris bila perlu.</p>
            </div>
            {invoices.length > 0 && (
              <div className="flex gap-2 text-sm">
                <button type="button" onClick={() => changeAmount(String(outstanding))} className="px-3 py-1.5 rounded border border-line hover:bg-subtle cursor-pointer">Pay all</button>
                <button type="button" onClick={() => { setForm((f) => ({ ...f, amount: '' })); setAlloc({}); }} className="px-3 py-1.5 rounded border border-line hover:bg-subtle cursor-pointer">Clear</button>
              </div>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: 760 }}>
              <thead className="bg-head text-head-fg text-left">
                <tr>
                  <th className={th}>{cfg.invoiceLabel}</th>
                  <th className={th}>Date</th>
                  <th className={th}>Due</th>
                  <th className={`${th} text-right`}>Total</th>
                  <th className={`${th} text-right`}>Balance</th>
                  <th className={`${th} w-44 text-right`}>Pay</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => {
                  const v = alloc[i._id] ?? '';
                  const over = Number(v) > i.balance;
                  return (
                    <tr key={i._id} className={over ? 'bg-danger-soft' : Number(v) > 0 ? 'bg-highlight' : 'hover:bg-subtle'}>
                      <td className={td}>
                        <Link to={`${cfg.invoicePath}/${i._id}`} className="font-mono text-xs font-semibold text-primary hover:underline">{i.no}</Link>
                        {i.vendorInvoiceNo && <div className="text-xs text-muted">Faktur {i.vendorInvoiceNo}</div>}
                      </td>
                      <td className={td}>{formatDay(i.date)}</td>
                      <td className={`${td} ${i.overdue ? 'text-danger font-semibold' : ''}`}>{i.dueDate ? formatDay(i.dueDate) : '-'}{i.overdue ? ' · overdue' : ''}</td>
                      <td className={`${td} text-right tabular-nums text-muted`}>{formatRupiah(i.total)}</td>
                      <td className={`${td} text-right tabular-nums`}>{formatRupiah(i.balance)}</td>
                      <td className={`${td} text-right`}>
                        <input aria-label={`Pay ${i.no}`} type="number" min="0" max={i.balance} step="0.01" value={v}
                          onChange={(e) => setAlloc((a) => ({ ...a, [i._id]: e.target.value }))} className={`${cellInput} text-right tabular-nums`} />
                      </td>
                    </tr>
                  );
                })}
                {!invoices.length && <tr><td colSpan={6} className="text-center py-8 text-muted"><i className="fa fa-check mr-1 text-success-fg"></i>Tidak ada yang belum lunas.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-4 px-4 py-3 border-t border-line text-sm">
            <span>Allocated <b className="tabular-nums">{formatRupiah(allocated)}</b> of {formatRupiah(amount)}</span>
            {diff !== 0 && amount > 0 && <span className="text-danger">Selisih {formatRupiah(diff)}</span>}
            <button type="button" onClick={submit} disabled={busy || !(amount > 0)} className={btnPrimary}>
              <i className="fa fa-check"></i> Save payment
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

/** Pembayaran gabungan: kind = 'customer' | 'vendor'; /:id = 'new' (?customer= / ?vendor=) atau id dokumen */
export default function PaymentBatchDetail({ kind }) {
  const cfg = BATCH_KINDS[kind];
  const { id } = useParams();
  const isNew = id === 'new';
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const perm = usePermission(cfg.resource);
  const toast = useToast();
  const [doc, setDoc] = useState(null);
  const [notFound, setNotFound] = useState(null);
  const [panel, setPanel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

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

  const cancel = async (reason) => {
    setBusy(true);
    try {
      const res = await cfg.cancel(id, reason, user.token);
      toast.success(res.data.message);
      setPanel(false);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to cancel');
    } finally {
      setBusy(false);
    }
  };

  const print = async () => {
    let company = {};
    try {
      company = (await getSettings(user.token)).values;
    } catch (err) {
      console.error(err);
    }
    printPaymentBatch(doc, company, {
      title: cfg.printTitle, subtitle: cfg.printSubtitle, partyHeading: cfg.partyHeading,
      partyName: cfg.partyName(doc[cfg.partyField]), invoiceField: cfg.invoiceField, methods: BATCH_METHODS,
    });
  };

  if (isNew) {
    return (
      <div className="h-full p-4 flex flex-col overflow-auto">
        <PageHeader fallbackTitle={cfg.title} parentPath={cfg.basePath} title={cfg.newTitle} subtitle={cfg.subtitle} />
        {perm.loaded && !perm.canCreate
          ? <p className="text-muted">You don&apos;t have permission to record payments.</p>
          : <NewBatch cfg={cfg} token={user.token} initialParty={searchParams.get(cfg.partyField)} />}
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <p className="text-xl font-semibold text-fg mb-1">Payment not available</p>
        <p className="text-muted mb-6">{notFound}</p>
        <Link to={cfg.basePath} className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded"><i className="fa fa-arrow-left"></i> Back</Link>
      </div>
    );
  }
  if (!doc) return <div className="p-6 text-muted">Loading...</div>;
  const posted = doc.status === 'POSTED';

  return (
    <div className="h-full p-4 flex flex-col overflow-auto">
      <PageHeader
        fallbackTitle={cfg.title}
        parentPath={cfg.basePath}
        title={doc.no}
        subtitle={`${cfg.partyName(doc[cfg.partyField])} · ${formatRupiah(doc.amount)}`}
        actions={(
          <>
            {posted
              ? <span className="text-xs px-2 py-0.5 rounded bg-success-soft text-success-fg">Posted</span>
              : <span className="text-xs px-2 py-0.5 rounded bg-danger-soft text-danger">Cancelled</span>}
            <button type="button" onClick={print} className={btnGhost}><i className="fa fa-print"></i> Print</button>
            {posted && perm.canUpdate && (
              <button type="button" onClick={() => setPanel((p) => !p)} disabled={busy} className={btnDanger}><i className="fa fa-ban"></i> Cancel</button>
            )}
          </>
        )}
      />
      {panel && (
        <ReasonPanel title={`Cancel ${doc.no}`} confirmLabel="Cancel payment" busy={busy} onConfirm={cancel} onClose={() => setPanel(false)}
          description={`Semua pembayaran di dokumen ini (${doc.allocations.length} ${cfg.invoiceLabel.toLowerCase()}) dibatalkan; sisa tagihannya kembali.`} />
      )}

      <div className="grid gap-4 items-start xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-lg border border-line bg-surface min-w-0">
          <div className="px-4 py-3 border-b border-line"><h3 className="font-semibold text-fg">Allocations ({doc.allocations.length})</h3></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: 640 }}>
              <thead className="bg-head text-head-fg text-left">
                <tr><th className={th}>{cfg.invoiceLabel}</th><th className={th}>Date</th><th className={th}>Due</th><th className={`${th} text-right`}>Total</th><th className={th}>Payment</th><th className={`${th} text-right`}>Amount</th></tr>
              </thead>
              <tbody>
                {doc.allocations.map((a) => {
                  const inv = a[cfg.invoiceField] || {};
                  return (
                    <tr key={a.payment?._id || inv._id} className="hover:bg-subtle">
                      <td className={td}>
                        <Link to={`${cfg.invoicePath}/${inv._id}`} className="font-mono text-xs font-semibold text-primary hover:underline">{inv.no}</Link>
                        {inv.vendorInvoiceNo && <div className="text-xs text-muted">Faktur {inv.vendorInvoiceNo}</div>}
                      </td>
                      <td className={td}>{formatDay(inv.date)}</td>
                      <td className={td}>{inv.dueDate ? formatDay(inv.dueDate) : '-'}</td>
                      <td className={`${td} text-right tabular-nums text-muted`}>{formatRupiah(inv.total)}</td>
                      <td className={`${td} font-mono text-xs ${a.payment?.status === 'CANCELLED' ? 'line-through text-muted' : ''}`}>{a.payment?.no}</td>
                      <td className={`${td} text-right tabular-nums font-medium`}>{formatRupiah(a.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end px-4 py-3 border-t border-line text-sm">Total <b className="ml-2 tabular-nums">{formatRupiah(doc.amount)}</b></div>
        </section>

        <aside className="space-y-4 min-w-0">
          <section className="rounded-lg border border-line bg-surface p-4 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
              <dt className="text-muted">{cfg.partyLabel}</dt><dd>{cfg.partyName(doc[cfg.partyField])}</dd>
              <dt className="text-muted">Date</dt><dd>{formatDay(doc.date)}</dd>
              <dt className="text-muted">Method</dt><dd>{BATCH_METHODS[doc.method] || doc.method}</dd>
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
