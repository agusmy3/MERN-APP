import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  getSalesReturn,
  createSalesReturn,
  updateSalesReturn,
  deleteSalesReturn,
  postSalesReturn,
  cancelSalesReturn,
  getReturnInvoiceOptions,
  getInvoiceForReturn,
} from '../services/salesService';
import { useAuth } from '../context/AuthContext';
import usePermission from '../hooks/usePermission';
import useToast from '../hooks/useToast';
import useConfirm from '../hooks/useConfirm';
import PageHeader from '../components/PageHeader';
import FormField from '../components/FormField';
import StatusBadge from '../components/stock/StatusBadge';
import ReasonPanel from '../components/stock/ReasonPanel';
import AuditTimeline from '../components/audit/AuditTimeline';
import { AuditDetail } from '../components/AuditInfo';
import { inputClass } from '../utils/formStyles';
import { formatNumber, formatRupiah, round2, variantLabel } from '../utils/formatHelper';
import { formatDate2, formatDay, toDateInput } from '../utils/dateHelper';
import { RETURN_STATUS_META } from '../utils/salesMeta';

const cellInput = `w-full bg-input text-fg border border-line rounded px-2 py-1 text-sm
  focus:outline-none focus:border-primary disabled:bg-transparent disabled:border-transparent`;
const btn = 'px-4 py-2 rounded text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
const btnGhost = `${btn} border border-line hover:bg-subtle`;
const btnPrimary = `${btn} bg-primary hover:bg-primary-hover text-primary-fg`;
const btnDanger = `${btn} border border-danger-line text-danger hover:bg-danger-soft`;

const isBlank = (v) => v === '' || v === null || v === undefined;

/** baris invoice -> baris form retur (qty = isian) */
const lineFromInvoice = (l, qty = '', note = '') => ({
  sku: { _id: l.sku?._id, sku: l.sku?.sku ?? '(deleted SKU)', produkName: l.produk?.name || '', variant: variantLabel(l.sku), uom: l.produk?.uom?.code || '' },
  sold: l.qty,
  returned: l.qtyReturned || 0,
  returnable: l.returnable ?? 0,
  unitAmount: l.unitAmount ?? null,
  qty,
  note,
});

const toPayload = (invoiceId, form, lines) => ({
  salesInvoice: invoiceId,
  date: form.date,
  reason: form.reason,
  lines: lines.filter((l) => !isBlank(l.qty) && Number(l.qty) !== 0).map((l) => ({ sku: l.sku._id, qty: l.qty, note: l.note })),
});

/** Pilih invoice POSTED yang masih bisa diretur (halaman /sales-return/new tanpa ?invoice=) */
function InvoiceChooser({ token, onPick }) {
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => {
      getReturnInvoiceOptions(token, search.trim()).then(setOptions).catch(console.error);
    }, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [token, search]);

  return (
    <section className="rounded-lg border border-line bg-surface p-4 max-w-3xl">
      <h3 className="font-semibold text-fg mb-1">Pilih invoice</h3>
      <p className="text-xs text-muted mb-3">Invoice yang sudah diposting dan masih punya barang yang bisa diretur.</p>
      <div className="relative mb-3">
        <i className="fa fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm"></i>
        <input type="search" autoFocus value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari no. invoice atau nama customer..." aria-label="Search invoice" className={`${inputClass} pl-9`} />
      </div>
      {options === null ? <p className="text-sm text-muted">Loading...</p> : options.length === 0 ? (
        <p className="text-sm text-muted">Tidak ada invoice yang bisa diretur.</p>
      ) : (
        <ul className="divide-y divide-line-soft border border-line-soft rounded max-h-96 overflow-auto">
          {options.map((o) => (
            <li key={o._id}>
              <button type="button" onClick={() => onPick(o._id)} className="w-full text-left px-3 py-2 hover:bg-subtle cursor-pointer flex items-center gap-3 text-sm">
                <span className="font-mono text-xs font-semibold text-primary w-40 shrink-0">{o.no}</span>
                <span className="text-muted w-24 shrink-0">{formatDay(o.date)}</span>
                <span className="flex-1 truncate">{o.customer?.name}</span>
                <span className="text-muted">{o.gudang?.code}</span>
                <span className="tabular-nums w-32 text-right">{formatRupiah(o.total)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Sales Return: /sales-return/:id (id = 'new', ?invoice= untuk invoice sumber)
 *   Draft  : isi qty retur per baris invoice (maks. terjual - sudah diretur) + alasan
 *   Post   : stok masuk kembali dengan HPP saat dijual, tagihan invoice berkurang (izin post)
 *   Cancel : stok keluar lagi (alasan wajib)
 */
export default function SalesReturnDetail() {
  const { id } = useParams();
  const isNew = id === 'new';
  const [searchParams, setSearchParams] = useSearchParams();
  const invoiceParam = searchParams.get('invoice');
  const navigate = useNavigate();
  const { user } = useAuth();
  const perm = usePermission('salesReturn');
  const movementPerm = usePermission('stockMovement');
  const toast = useToast();
  const confirm = useConfirm();

  const [doc, setDoc] = useState(null);
  const [invoice, setInvoice] = useState(null);
  const [notFound, setNotFound] = useState(null);
  const [form, setForm] = useState(null);
  const [lines, setLines] = useState([]);
  const [savedPayload, setSavedPayload] = useState(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [cancelOpen, setCancelOpen] = useState(false);

  const fail = (err, fallback) => {
    const s = err.response?.status;
    if ([400, 403, 404].includes(s)) setNotFound(err.response?.data?.message || fallback);
    else console.error(err);
  };

  const load = useCallback(async () => {
    try {
      const d = await getSalesReturn(id, user.token);
      const f = { date: toDateInput(d.date), reason: d.reason || '' };
      let ls;
      let inv = null;
      if (d.status === 'DRAFT') {
        // draft: tampilkan semua baris invoice supaya bisa menambah / mengubah qty
        inv = await getInvoiceForReturn(d.salesInvoice._id, user.token).catch(() => null);
      }
      if (inv) {
        const qtyOf = new Map(d.lines.map((l) => [String(l.sku?._id), l]));
        ls = inv.lines.map((l) => {
          const cur = qtyOf.get(String(l.sku?._id));
          return lineFromInvoice(l, cur?.qty ?? '', cur?.note || '');
        });
      } else {
        ls = d.lines.map((l) => ({
          ...lineFromInvoice({ ...l, qty: l.sold, qtyReturned: l.returned, returnable: l.returnable }, l.qty, l.note || ''),
          amount: l.amount,
          unitAmount: l.qty ? round2(l.amount / l.qty) : null,
        }));
      }
      setDoc(d);
      setInvoice(inv);
      setForm(f);
      setLines(ls);
      setSavedPayload(JSON.stringify(toPayload(d.salesInvoice._id, f, ls)));
      setVersion((v) => v + 1);
    } catch (err) {
      fail(err, 'Retur mungkin sudah dihapus.');
    }
   
  }, [id, user.token]);

  useEffect(() => {
    if (!isNew) {
      load();
      return;
    }
    setDoc(null);
    setSavedPayload(null);
    setForm({ date: toDateInput(), reason: '' });
    setLines([]);
    setInvoice(null);
    if (!invoiceParam) return;
    getInvoiceForReturn(invoiceParam, user.token)
      .then((inv) => {
        setInvoice(inv);
        setLines(inv.lines.map((l) => lineFromInvoice(l)));
      })
      .catch((err) => fail(err, 'Invoice tidak bisa diretur.'));
   
  }, [isNew, invoiceParam, load, user.token]);

  const status = isNew ? 'DRAFT' : doc?.status;
  const isDraft = status === 'DRAFT';
  const editable = isDraft && (isNew ? perm.canCreate : perm.canUpdate) && !!invoice;
  const invoiceId = invoice?._id || doc?.salesInvoice?._id || null;
  const payload = form && invoiceId ? toPayload(invoiceId, form, lines) : null;
  const dirty = editable && (isNew ? payload?.lines.length > 0 : JSON.stringify(payload) !== savedPayload);

  const setLine = (skuId, field, value) => setLines((prev) => prev.map((l) => (l.sku._id === skuId ? { ...l, [field]: value } : l)));
  const fillAll = () => setLines((prev) => prev.map((l) => ({ ...l, qty: l.returnable || '' })));
  const clearAll = () => setLines((prev) => prev.map((l) => ({ ...l, qty: '' })));

  const summary = useMemo(() => {
    let qty = 0;
    let value = 0;
    let count = 0;
    for (const l of lines) {
      const q = Number(l.qty) || 0;
      if (!q) continue;
      count++;
      qty = round2(qty + q);
      value = round2(value + (l.amount ?? q * (l.unitAmount || 0)));
    }
    return { qty, value, count };
  }, [lines]);

  // ---------- aksi ----------
  const validate = () => {
    if (!form.reason.trim()) return 'Isi alasan retur.';
    if (!payload.lines.length) return 'Isi qty retur minimal 1 barang.';
    const bad = lines.find((l) => !isBlank(l.qty) && (Number(l.qty) < 0 || Number(l.qty) > l.returnable));
    if (bad) return `${bad.sku.sku}: qty retur 0 – ${formatNumber(bad.returnable)}.`;
    return null;
  };

  const save = async ({ quiet = false, stay = false } = {}) => {
    const error = validate();
    if (error) {
      toast.warning(error);
      return null;
    }
    setBusy(true);
    try {
      const res = isNew ? await createSalesReturn(payload, user.token) : await updateSalesReturn(id, payload, user.token);
      if (!quiet) toast.success(res.data.message);
      const saved = res.data.data;
      if (isNew && !stay) navigate(`/sales-return/${saved._id}`, { replace: true });
      else if (!stay) await load();
      return saved._id;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save return');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const post = async () => {
    const error = dirty || isNew ? validate() : null;
    if (error) return toast.warning(error);
    const ok = await confirm({
      title: `Post ${doc?.no || 'return'}?`,
      message: `${formatNumber(summary.qty)} barang (${summary.count} SKU) masuk kembali ke stok ${invoice?.gudang?.code || doc?.gudang?.code} `
        + `dan tagihan ${invoice?.no || doc?.salesInvoice?.no} berkurang ± ${formatRupiah(summary.value)}. Barang rusak dikeluarkan lewat Stock Adjustment.`,
      confirmLabel: dirty || isNew ? 'Save & Post' : 'Post',
    });
    if (!ok) return;
    let docId = isNew ? null : id;
    if (dirty || isNew) {
      docId = await save({ quiet: true, stay: true });
      if (!docId) return;
    }
    setBusy(true);
    try {
      const res = await postSalesReturn(docId, user.token);
      toast.success(res.data.message);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to post return');
    } finally {
      setBusy(false);
      if (isNew) navigate(`/sales-return/${docId}`, { replace: true });
      else await load();
    }
  };

  const removeDraft = async () => {
    const ok = await confirm({ title: `Delete ${doc.no}?`, message: 'Draft ini akan dihapus permanen. Stok tidak terpengaruh.', confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
    try {
      const res = await deleteSalesReturn(id, user.token);
      toast.success(res.data.message);
      navigate('/sales-return');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete return');
    }
  };

  const cancelDoc = async (reason) => {
    setBusy(true);
    try {
      const res = await cancelSalesReturn(id, reason, user.token);
      toast.success(res.data.message);
      setCancelOpen(false);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to cancel return');
    } finally {
      setBusy(false);
    }
  };

  // ---------- render ----------
  if (notFound) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <p className="text-xl font-semibold text-fg mb-1">Return not available</p>
        <p className="text-muted mb-6">{notFound}</p>
        <Link to="/sales-return" className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded">
          <i className="fa fa-arrow-left"></i> Back to Sales Return
        </Link>
      </div>
    );
  }
  if (!form) return <div className="p-6 text-muted">Loading...</div>;
  if (isNew && perm.loaded && !perm.canCreate) {
    return <div className="p-6 text-muted">You don&apos;t have permission to create sales returns.</div>;
  }

  const header = (
    <PageHeader
      fallbackTitle="Sales Return"
      parentPath="/sales-return"
      title={doc?.no || 'New Return'}
      subtitle="Retur atas invoice yang sudah diposting: stok masuk kembali dengan HPP saat dijual."
      actions={(
        <>
          {!isNew && <StatusBadge status={status} meta={RETURN_STATUS_META} />}
          {isDraft && !isNew && perm.canDelete && (
            <button type="button" onClick={removeDraft} disabled={busy} className={btnDanger}>
              <i className="fa fa-trash"></i> Delete
            </button>
          )}
          {editable && (
            <button type="button" onClick={() => save()} disabled={busy || (!isNew && !dirty)} className={btnGhost}>
              <i className="fa fa-save"></i> Save draft
            </button>
          )}
          {isDraft && perm.canPost && !!invoiceId && (isNew ? perm.canCreate : true) && (
            <button type="button" onClick={post} disabled={busy || (!summary.count) || (dirty && !editable)} className={btnPrimary}>
              <i className="fa fa-check"></i> {dirty || isNew ? 'Save & Post' : 'Post'}
            </button>
          )}
          {status === 'POSTED' && perm.canPost && (
            <button type="button" onClick={() => setCancelOpen((o) => !o)} disabled={busy} className={btnDanger}>
              <i className="fa fa-ban"></i> Cancel return
            </button>
          )}
        </>
      )}
    />
  );

  if (isNew && !invoiceParam) {
    return (
      <div className="h-full p-4 flex flex-col overflow-auto">
        {header}
        <InvoiceChooser token={user.token} onPick={(invId) => setSearchParams({ invoice: invId }, { replace: true })} />
      </div>
    );
  }
  if (isNew && !invoice) return <div className="p-6 text-muted">Loading...</div>;

  const src = invoice || { no: doc?.salesInvoice?.no, _id: doc?.salesInvoice?._id, customer: doc?.customer, gudang: doc?.gudang };

  return (
    <div className="h-full p-4 flex flex-col overflow-auto">
      {header}

      {cancelOpen && (
        <ReasonPanel
          title={`Cancel ${doc.no}`}
          description={`Stok keluar lagi dari ${doc.gudang?.code} (pergerakan pembalik) dan tagihan invoice kembali bertambah.`}
          placeholder="Alasan pembatalan (wajib)"
          confirmLabel="Cancel return"
          busy={busy}
          onConfirm={cancelDoc}
          onClose={() => setCancelOpen(false)}
        />
      )}

      <div className={`grid gap-4 items-start ${doc ? 'xl:grid-cols-[minmax(0,1fr)_320px]' : ''}`}>
        <div className="space-y-4 min-w-0">
          <section className="rounded-lg border border-line bg-surface p-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <FormField label="Invoice">
                <div className="py-2 text-sm">
                  <Link to={`/sales-invoice/${src._id}`} className="font-mono font-semibold text-primary hover:underline">{src.no}</Link>
                  {isNew && (
                    <button type="button" onClick={() => setSearchParams({}, { replace: true })} className="ml-2 text-xs text-muted hover:text-fg cursor-pointer">
                      ganti
                    </button>
                  )}
                </div>
              </FormField>
              <FormField label="Customer · Warehouse">
                <div className="py-2 text-sm">{src.customer?.name || '-'} · {src.gudang?.code || '-'}</div>
              </FormField>
              <fieldset disabled={!editable || busy} className="contents">
                <FormField label="Date" htmlFor="rtn-date" required>
                  <input id="rtn-date" type="date" max={toDateInput()} value={form.date}
                    onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className={inputClass} />
                </FormField>
                <FormField label="Reason" htmlFor="rtn-reason" required>
                  <input id="rtn-reason" value={form.reason} placeholder="mis. barang cacat, salah kirim"
                    onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} className={inputClass} />
                </FormField>
              </fieldset>
            </div>
          </section>

          <section className="rounded-lg border border-line bg-surface">
            <div className="px-4 py-3 border-b border-line flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-fg">Items</h3>
                <p className="text-xs text-muted">
                  {editable ? 'Isi qty yang dikembalikan (maks. terjual − sudah diretur). Baris kosong diabaikan.' : 'Barang yang diretur.'}
                </p>
              </div>
              {editable && (
                <div className="flex gap-2">
                  <button type="button" onClick={fillAll} className={`${btnGhost} py-1`}>Fill all</button>
                  <button type="button" onClick={clearAll} className={`${btnGhost} py-1`}>Clear</button>
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: 820 }}>
                <thead className="bg-head text-head-fg text-left">
                  <tr>
                    <th className="px-2 py-2 border-b border-line font-semibold w-10 text-right">#</th>
                    <th className="px-2 py-2 border-b border-line font-semibold">SKU</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-24 text-right">Sold</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-24 text-right" title="Retur yang sudah diposting">Returned</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-28 text-right">Return qty</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-36 text-right" title="Harga bersih (setelah diskon & PPN, proporsional invoice)">Value</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-48">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, index) => {
                    const q = Number(l.qty) || 0;
                    const over = editable && q > l.returnable;
                    const value = l.amount ?? (q ? round2(q * (l.unitAmount || 0)) : null);
                    return (
                      <tr key={l.sku._id || index} className={over ? 'bg-danger-soft' : q ? '' : 'hover:bg-subtle'}>
                        <td className="px-2 py-1.5 border-t border-line-soft text-right text-muted tabular-nums">{index + 1}</td>
                        <td className="px-2 py-1.5 border-t border-line-soft">
                          <div className="font-mono text-xs font-semibold text-fg">{l.sku.sku}</div>
                          <div className="text-xs text-muted truncate max-w-72">{l.sku.produkName} · {l.sku.variant}</div>
                        </td>
                        <td className="px-2 py-1.5 border-t border-line-soft text-right tabular-nums text-muted">{l.sold === null || l.sold === undefined ? '-' : `${formatNumber(l.sold)} ${l.sku.uom}`}</td>
                        <td className="px-2 py-1.5 border-t border-line-soft text-right tabular-nums text-muted">{formatNumber(l.returned || 0)}</td>
                        <td className="px-2 py-1.5 border-t border-line-soft text-right">
                          {editable ? (
                            <input aria-label={`Return qty ${l.sku.sku}`} type="number" min="0" max={l.returnable} step="0.01" value={l.qty} disabled={busy || !l.returnable}
                              placeholder={l.returnable ? `maks. ${formatNumber(l.returnable)}` : 'habis'}
                              onChange={(e) => setLine(l.sku._id, 'qty', e.target.value)} className={`${cellInput} text-right tabular-nums ${over ? 'border-danger' : ''}`} />
                          ) : <span className="tabular-nums font-medium">{formatNumber(l.qty)}</span>}
                        </td>
                        <td className="px-2 py-1.5 border-t border-line-soft text-right tabular-nums">{value === null ? '-' : formatRupiah(value)}</td>
                        <td className="px-2 py-1.5 border-t border-line-soft">
                          <input aria-label={`Note ${l.sku.sku}`} value={l.note} maxLength={200} disabled={!editable || busy}
                            onChange={(e) => setLine(l.sku._id, 'note', e.target.value)} className={cellInput} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 px-4 py-3 border-t border-line text-sm">
              <span>Qty: <b className="tabular-nums">{formatNumber(summary.qty)}</b></span>
              <span>Return value{isDraft ? ' (est.)' : ''}: <b className="tabular-nums">{formatRupiah(isDraft ? summary.value : doc.total)}</b></span>
              {!isDraft && <span className="text-muted">DPP {formatRupiah(doc.dpp)} · PPN {formatRupiah(doc.taxAmount)}</span>}
              {!isDraft && doc.cogs !== undefined && doc.cogs !== null && <span className="text-muted">HPP {formatRupiah(doc.cogs)}</span>}
            </div>
          </section>
        </div>

        {doc && (
          <aside className="space-y-4 min-w-0">
            <section className="rounded-lg border border-line bg-surface p-4 text-sm space-y-2">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                <dt className="text-muted">Status</dt><dd><StatusBadge status={doc.status} meta={RETURN_STATUS_META} /></dd>
                <dt className="text-muted">Invoice</dt>
                <dd><Link to={`/sales-invoice/${doc.salesInvoice?._id}`} className="font-mono text-xs font-semibold text-primary hover:underline">{doc.salesInvoice?.no}</Link></dd>
                {doc.postedDate && (<><dt className="text-muted">Posted</dt><dd>{formatDate2(doc.postedDate)} · {doc.postedBy?.name || '-'}</dd></>)}
                {doc.cancelledDate && (<><dt className="text-muted">Cancelled</dt><dd>{formatDate2(doc.cancelledDate)} · {doc.cancelledBy?.name || '-'}</dd></>)}
                {doc.cancelReason && (<><dt className="text-muted">Reason</dt><dd className="break-words">{doc.cancelReason}</dd></>)}
              </dl>
              {doc.status !== 'DRAFT' && movementPerm.canView && (
                <Link to={`/stock-movement?search=${encodeURIComponent(doc.no)}`} className="inline-block text-primary hover:underline">
                  <i className="fa fa-right-left mr-1"></i> View stock movements
                </Link>
              )}
            </section>
            <AuditDetail data={doc} />
            <section className="rounded-lg border border-line bg-surface p-4">
              <h3 className="font-semibold text-fg mb-2">History</h3>
              <AuditTimeline entity="salesReturn" id={doc._id} refreshKey={version} />
            </section>
          </aside>
        )}
      </div>
    </div>
  );
}
