import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  getCostRevaluation,
  createCostRevaluation,
  updateCostRevaluation,
  deleteCostRevaluation,
  postCostRevaluation,
  cancelCostRevaluation,
  searchRevaluationSkus,
} from '../services/stockService';
import { useAuth } from '../context/AuthContext';
import usePermission from '../hooks/usePermission';
import useToast from '../hooks/useToast';
import useConfirm from '../hooks/useConfirm';
import PageHeader from '../components/PageHeader';
import FormField from '../components/FormField';
import SkuPicker from '../components/stock/SkuPicker';
import StatusBadge from '../components/stock/StatusBadge';
import ReasonPanel from '../components/stock/ReasonPanel';
import AuditTimeline from '../components/audit/AuditTimeline';
import { AuditDetail } from '../components/AuditInfo';
import { inputClass } from '../utils/formStyles';
import { formatNumber, formatRupiah, round2, variantLabel } from '../utils/formatHelper';
import { formatDate2, toDateInput } from '../utils/dateHelper';

const cellInput = `w-full bg-input text-fg border border-line rounded px-2 py-1 text-sm
  focus:outline-none focus:border-primary disabled:bg-transparent disabled:border-transparent`;
const btn = 'px-4 py-2 rounded text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
const btnGhost = `${btn} border border-line hover:bg-subtle`;
const btnPrimary = `${btn} bg-primary hover:bg-primary-hover text-primary-fg`;
const btnDanger = `${btn} border border-danger-line text-danger hover:bg-danger-soft`;

const lineFromDoc = (l) => ({
  sku: { _id: l.sku?._id, sku: l.sku?.sku ?? '(deleted SKU)', produkName: l.produk?.name || '', variant: variantLabel(l.sku), uom: l.produk?.uom?.code || '' },
  qty: l.qty ?? 0,
  oldCost: l.oldCost ?? null,
  newCost: l.newCost ?? '',
  valueChange: l.valueChange ?? null,
  note: l.note || '',
});
const lineFromSearch = (s) => ({
  sku: { _id: s._id, sku: s.sku, produkName: s.produk?.name || '', variant: s.variant, uom: s.uom },
  qty: s.qty,
  oldCost: s.avgCost ?? null,
  newCost: '',
  valueChange: null,
  note: '',
});
const toPayload = (form, lines) => ({
  date: form.date,
  note: form.note,
  lines: lines.map((l) => ({ sku: l.sku._id, newCost: l.newCost, note: l.note })),
});
const isBlank = (v) => v === '' || v === null || v === undefined;

/**
 * Revaluasi HPP: /cost-revaluation/:id (id = 'new', ?missing=1 = muat semua SKU berstok tanpa HPP)
 * Mengisi / mengoreksi HPP tanpa mengubah stok. Post & Cancel butuh izin `post`.
 */
export default function CostRevaluationDetail() {
  const { id } = useParams();
  const isNew = id === 'new';
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const perm = usePermission('costRevaluation');
  const toast = useToast();
  const confirm = useConfirm();

  const [doc, setDoc] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [form, setForm] = useState(null);
  const [lines, setLines] = useState([]);
  const [savedPayload, setSavedPayload] = useState(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [cancelOpen, setCancelOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await getCostRevaluation(id, user.token);
      const f = { date: toDateInput(d.date), note: d.note || '' };
      const ls = d.lines.map(lineFromDoc);
      setDoc(d);
      setForm(f);
      setLines(ls);
      setSavedPayload(JSON.stringify(toPayload(f, ls)));
      setVersion((v) => v + 1);
    } catch (err) {
      if ([400, 404].includes(err.response?.status)) setNotFound(true);
      else console.error(err);
    }
  }, [id, user.token]);

  const loadMissing = useCallback(async (quiet = false) => {
    try {
      const skus = await searchRevaluationSkus(user.token, { missingOnly: true });
      setLines((prev) => {
        const have = new Set(prev.map((l) => l.sku._id));
        const fresh = skus.filter((s) => !have.has(s._id));
        if (!quiet) toast.info(fresh.length ? `${fresh.length} SKU tanpa HPP ditambahkan.` : 'Tidak ada SKU berstok tanpa HPP lagi.');
        return [...prev, ...fresh.map(lineFromSearch)];
      });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load SKUs');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.token]);

  useEffect(() => {
    if (!isNew) {
      load();
      return;
    }
    setDoc(null);
    setLines([]);
    setSavedPayload(null);
    setForm({ date: toDateInput(), note: searchParams.get('missing') ? 'Isi HPP stok lama yang belum punya harga pokok' : '' });
    if (searchParams.get('missing')) loadMissing(true);
  }, [isNew, load, searchParams, loadMissing]);

  const status = isNew ? 'DRAFT' : doc?.status;
  const isDraft = status === 'DRAFT';
  const editable = isNew ? perm.canCreate : isDraft && perm.canUpdate;
  const payload = form ? toPayload(form, lines) : null;
  const dirty = editable && (isNew ? lines.length > 0 : JSON.stringify(payload) !== savedPayload);
  const existing = useMemo(() => new Set(lines.map((l) => l.sku._id)), [lines]);

  const setLine = (skuId, patch) => setLines((prev) => prev.map((l) => (l.sku._id === skuId ? { ...l, ...patch } : l)));
  const changeOf = (l) => {
    if (!isDraft) return l.valueChange;
    if (isBlank(l.newCost)) return null;
    return round2(l.qty * (Number(l.newCost) - (l.oldCost ?? 0)));
  };
  const totalChange = round2(lines.reduce((s, l) => s + (changeOf(l) || 0), 0));

  const validate = () => {
    if (!form.note.trim()) return 'Isi alasan revaluasi.';
    if (!lines.length) return 'Tambahkan minimal 1 SKU.';
    const empty = lines.filter((l) => isBlank(l.newCost));
    if (empty.length) return `${empty.length} SKU belum diisi HPP barunya.`;
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
      const res = isNew ? await createCostRevaluation(payload, user.token) : await updateCostRevaluation(id, payload, user.token);
      if (!quiet) toast.success(res.data.message);
      const savedId = res.data.data._id;
      if (isNew && !stay) navigate(`/cost-revaluation/${savedId}`, { replace: true });
      else if (!isNew && !stay) await load();
      return savedId;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save document');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const post = async () => {
    const error = validate();
    if (error) return toast.warning(error);
    const ok = await confirm({
      title: `Post ${doc?.no || 'revaluation'}?`,
      message: `HPP ${lines.length} SKU akan diganti (stok tidak berubah). Perkiraan perubahan nilai persediaan: ${formatRupiah(totalChange)}. `
        + 'HPP lama diambil saat Post. Setelah diposting hanya bisa dibatalkan selama HPP belum berubah lagi.',
      confirmLabel: dirty ? 'Save & Post' : 'Post',
    });
    if (!ok) return;
    let docId = isNew ? null : id;
    if (dirty) {
      docId = await save({ quiet: true, stay: true });
      if (!docId) return;
    }
    setBusy(true);
    try {
      const res = await postCostRevaluation(docId, user.token);
      toast.success(res.data.message);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to post document');
    } finally {
      setBusy(false);
      if (isNew) navigate(`/cost-revaluation/${docId}`, { replace: true });
      else await load();
    }
  };

  const removeDraft = async () => {
    const ok = await confirm({ title: `Delete ${doc.no}?`, message: 'Draft ini akan dihapus. HPP tidak terpengaruh.', confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
    try {
      const res = await deleteCostRevaluation(id, user.token);
      toast.success(res.data.message);
      navigate('/cost-revaluation');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete document');
    }
  };

  const cancelDoc = async (reason) => {
    setBusy(true);
    try {
      const res = await cancelCostRevaluation(id, reason, user.token);
      toast.success(res.data.message);
      setCancelOpen(false);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to cancel document');
    } finally {
      setBusy(false);
    }
  };

  if (notFound) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <p className="text-xl font-semibold text-fg mb-1">Document not found</p>
        <Link to="/cost-revaluation" className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded mt-4">
          <i className="fa fa-arrow-left"></i> Back to Cost Revaluation
        </Link>
      </div>
    );
  }
  if (!form) return <div className="p-6 text-muted">Loading...</div>;
  if (isNew && perm.loaded && !perm.canCreate) {
    return <div className="p-6 text-muted">You don&apos;t have permission to create cost revaluations.</div>;
  }

  return (
    <div className="h-full p-4 flex flex-col overflow-auto">
      <PageHeader
        fallbackTitle="Cost Revaluation"
        parentPath="/cost-revaluation"
        title={doc?.no || 'New Cost Revaluation'}
        subtitle="Isi / koreksi HPP rata-rata SKU tanpa mengubah jumlah stok."
        actions={(
          <>
            {!isNew && <StatusBadge status={status} />}
            {isDraft && !isNew && perm.canDelete && (
              <button type="button" onClick={removeDraft} disabled={busy} className={btnDanger}><i className="fa fa-trash"></i> Delete</button>
            )}
            {editable && (
              <button type="button" onClick={() => save()} disabled={busy || (!isNew && !dirty)} className={btnGhost}>
                <i className="fa fa-save"></i> Save draft
              </button>
            )}
            {isDraft && perm.canPost && (!isNew || perm.canCreate) && (
              <button type="button" onClick={post} disabled={busy || !lines.length || (dirty && !editable)} className={btnPrimary}>
                <i className="fa fa-check-double"></i> {dirty ? 'Save & Post' : 'Post'}
              </button>
            )}
            {status === 'POSTED' && perm.canPost && (
              <button type="button" onClick={() => setCancelOpen((o) => !o)} disabled={busy} className={btnDanger}>
                <i className="fa fa-ban"></i> Cancel document
              </button>
            )}
          </>
        )}
      />

      {cancelOpen && (
        <ReasonPanel
          title={`Cancel ${doc.no}`}
          description="HPP dikembalikan ke nilai sebelum revaluasi. Ditolak jika HPP salah satu SKU sudah berubah lagi (mis. ada penerimaan barang)."
          confirmLabel="Cancel document"
          busy={busy}
          onConfirm={cancelDoc}
          onClose={() => setCancelOpen(false)}
        />
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] items-start">
        <div className="space-y-4 min-w-0">
          <section className="rounded-lg border border-line bg-surface p-4">
            <fieldset disabled={!editable || busy} className="grid gap-4 sm:grid-cols-[200px_1fr]">
              <FormField label="Date" htmlFor="rev-date" required>
                <input id="rev-date" type="date" max={toDateInput()} value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className={inputClass} />
              </FormField>
              <FormField label="Reason" htmlFor="rev-note" required>
                <input id="rev-note" value={form.note} placeholder="mis. HPP stok lama, koreksi salah input"
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className={inputClass} />
              </FormField>
            </fieldset>
          </section>

          <section className="rounded-lg border border-line bg-surface">
            <div className="px-4 py-3 border-b border-line">
              <h3 className="font-semibold text-fg">SKU ({lines.length})</h3>
              <p className="text-xs text-muted">HPP per satuan dasar, maks. 2 desimal. Perubahan nilai = stok total x (HPP baru − HPP lama).</p>
            </div>
            {editable && (
              <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-line-soft bg-subtle">
                <SkuPicker token={user.token} existing={existing} searchFn={searchRevaluationSkus}
                  onAdd={(skus) => setLines((prev) => [...prev, ...skus.filter((s) => !existing.has(s._id)).map(lineFromSearch)])} />
                <button type="button" onClick={() => loadMissing()} className={btnGhost}>
                  <i className="fa fa-triangle-exclamation"></i> Load SKU without HPP
                </button>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: 860 }}>
                <thead className="bg-head text-head-fg text-left">
                  <tr>
                    <th className="px-3 py-2 border-b border-line font-semibold w-10 text-right">#</th>
                    <th className="px-3 py-2 border-b border-line font-semibold">SKU</th>
                    <th className="px-3 py-2 border-b border-line font-semibold w-28 text-right">Stock</th>
                    <th className="px-3 py-2 border-b border-line font-semibold w-32 text-right">{isDraft ? 'Current HPP' : 'Old HPP'}</th>
                    <th className="px-3 py-2 border-b border-line font-semibold w-36 text-right">New HPP</th>
                    <th className="px-3 py-2 border-b border-line font-semibold w-40 text-right">Value change{isDraft ? ' (est.)' : ''}</th>
                    <th className="px-3 py-2 border-b border-line font-semibold w-48">Note</th>
                    {editable && <th className="px-3 py-2 border-b border-line w-12"></th>}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, index) => {
                    const change = changeOf(l);
                    return (
                      <tr key={l.sku._id || index} className="hover:bg-subtle">
                        <td className="px-3 py-1.5 border-t border-line-soft text-right text-muted tabular-nums">{index + 1}</td>
                        <td className="px-3 py-1.5 border-t border-line-soft">
                          <div className="font-mono text-xs font-semibold">{l.sku.sku}</div>
                          <div className="text-xs text-muted truncate max-w-72">{l.sku.produkName} · {l.sku.variant}</div>
                        </td>
                        <td className="px-3 py-1.5 border-t border-line-soft text-right tabular-nums">{formatNumber(l.qty)} {l.sku.uom}</td>
                        <td className="px-3 py-1.5 border-t border-line-soft text-right tabular-nums">
                          {l.oldCost === null ? <span className="text-warning-fg">none</span> : formatRupiah(l.oldCost)}
                        </td>
                        <td className="px-3 py-1.5 border-t border-line-soft text-right">
                          {editable ? (
                            <input aria-label={`New HPP ${l.sku.sku}`} type="number" min="0" step="0.01" data-qty-index={index}
                              value={l.newCost} disabled={busy} onChange={(e) => setLine(l.sku._id, { newCost: e.target.value })}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); document.querySelector(`[data-qty-index="${index + 1}"]`)?.focus(); } }}
                              className={`${cellInput} text-right tabular-nums`} />
                          ) : <span className="tabular-nums font-medium">{formatRupiah(l.newCost)}</span>}
                        </td>
                        <td className={`px-3 py-1.5 border-t border-line-soft text-right tabular-nums ${change < 0 ? 'text-danger' : change > 0 ? 'text-success-fg' : 'text-muted'}`}>
                          {change === null ? '-' : formatRupiah(change)}
                        </td>
                        <td className="px-3 py-1.5 border-t border-line-soft">
                          {editable ? (
                            <input aria-label={`Note ${l.sku.sku}`} value={l.note} maxLength={200} disabled={busy}
                              onChange={(e) => setLine(l.sku._id, { note: e.target.value })} className={cellInput} />
                          ) : <span className="text-muted">{l.note}</span>}
                        </td>
                        {editable && (
                          <td className="px-3 py-1.5 border-t border-line-soft text-center">
                            <button type="button" title="Remove line" aria-label={`Remove ${l.sku.sku}`}
                              onClick={() => setLines((prev) => prev.filter((x) => x.sku._id !== l.sku._id))}
                              className="w-8 h-8 rounded-md text-muted hover:text-danger hover:bg-danger-soft cursor-pointer">
                              <i className="fa fa-xmark"></i>
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {lines.length === 0 && (
                    <tr><td colSpan={8} className="text-center py-8 text-muted">Belum ada SKU.{editable && ' Cari SKU, atau muat SKU yang belum punya HPP.'}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {lines.length > 0 && (
              <div className="px-4 py-3 border-t border-line text-sm">
                Total value change{isDraft ? ' (est.)' : ''}:{' '}
                <b className={`tabular-nums ${totalChange < 0 ? 'text-danger' : 'text-success-fg'}`}>{formatRupiah(totalChange)}</b>
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4 min-w-0">
          {doc && (
            <section className="rounded-lg border border-line bg-surface p-4 text-sm">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                <dt className="text-muted">Status</dt><dd><StatusBadge status={doc.status} /></dd>
                {doc.postedDate && (<><dt className="text-muted">Posted</dt><dd>{formatDate2(doc.postedDate)} · {doc.postedBy?.name || '-'}</dd></>)}
                {doc.cancelledDate && (<><dt className="text-muted">Cancelled</dt><dd>{formatDate2(doc.cancelledDate)} · {doc.cancelledBy?.name || '-'}</dd></>)}
                {doc.cancelReason && (<><dt className="text-muted">Reason</dt><dd className="break-words">{doc.cancelReason}</dd></>)}
              </dl>
            </section>
          )}
          {doc && <AuditDetail data={doc} />}
          {doc && (
            <section className="rounded-lg border border-line bg-surface p-4">
              <h3 className="font-semibold text-fg mb-2">History</h3>
              <AuditTimeline entity="costRevaluation" id={doc._id} refreshKey={version} />
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
