import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  getPurchaseReturn, getReturnableGrs, getGrForReturn, createPurchaseReturn, updatePurchaseReturn, deletePurchaseReturn,
  postPurchaseReturn, cancelPurchaseReturn,
} from '../services/purchaseService';
import { useAuth } from '../context/AuthContext';
import usePermission from '../hooks/usePermission';
import useToast from '../hooks/useToast';
import useConfirm from '../hooks/useConfirm';
import PageHeader from '../components/PageHeader';
import FormField from '../components/FormField';
import StatusBadge from '../components/stock/StatusBadge';
import ReasonPanel from '../components/stock/ReasonPanel';
import AuditTimeline from '../components/audit/AuditTimeline';
import { inputClass } from '../utils/formStyles';
import { formatNumber, formatRupiah, round2, variantLabel } from '../utils/formatHelper';
import { formatDate2, formatDay, toDateInput } from '../utils/dateHelper';
import { GR_STATUS_META, PO_STATUS_META, RETURN_RESOLUTIONS } from '../utils/purchaseMeta';

const cellInput = `w-full bg-input text-fg border border-line rounded px-2 py-1 text-sm
  focus:outline-none focus:border-primary disabled:bg-transparent disabled:border-transparent`;
const btn = 'px-4 py-2 rounded text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
const btnGhost = `${btn} border border-line hover:bg-subtle`;
const btnPrimary = `${btn} bg-primary hover:bg-primary-hover text-primary-fg`;
const btnDanger = `${btn} border border-danger-line text-danger hover:bg-danger-soft`;
const th = 'px-2 py-2 border-b border-line font-semibold';
const td = 'px-2 py-1.5 border-t border-line-soft';

/** Pilih Goods Receipt yang masih bisa diretur */
function GrSelect({ token, onSelect }) {
  const [search, setSearch] = useState('');
  const [list, setList] = useState([]);
  useEffect(() => {
    const t = setTimeout(() => getReturnableGrs(token, search).then(setList).catch(console.error), 300);
    return () => clearTimeout(t);
  }, [token, search]);
  return (
    <section className="rounded-lg border border-line bg-surface p-4 max-w-3xl space-y-3">
      <div>
        <h3 className="font-semibold text-fg">Pilih Goods Receipt</h3>
        <p className="text-sm text-muted">Retur dibuat dari penerimaan barang yang sudah diposting.</p>
      </div>
      <input type="search" aria-label="Search goods receipt" placeholder="Cari no. GR, surat jalan vendor, vendor..." value={search}
        onChange={(e) => setSearch(e.target.value)} className={inputClass} autoFocus />
      <ul className="divide-y divide-line-soft border border-line rounded">
        {list.map((g) => (
          <li key={g._id}>
            <button type="button" onClick={() => onSelect(g._id)} className="w-full text-left px-3 py-2 hover:bg-subtle cursor-pointer flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="font-mono text-sm font-semibold text-primary">{g.no}</span>
              <span className="text-sm">{g.vendor?.companyName}</span>
              <span className="text-xs text-muted">{formatDay(g.date)} · {g.gudang?.code} · {g.purchaseOrder?.no}{g.purchaseInvoice ? ' · sudah ditagih' : ''}</span>
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="px-3 py-3 text-sm text-muted">Tidak ada penerimaan barang yang bisa diretur.</li>}
      </ul>
    </section>
  );
}

const lineFromGr = (l, existing) => ({
  poLine: String(l.poLine),
  sku: l.sku?.sku ?? '(deleted SKU)',
  produkName: l.produk?.name || '',
  variant: variantLabel(l.sku),
  uom: l.uomBeli?.code || '',
  baseUom: l.produk?.uom?.code || '',
  konversi: l.konversi,
  received: l.qty,
  returned: l.qtyReturned || 0,
  returnable: l.returnable,
  unitAmount: l.unitAmount ?? null,
  qty: existing ? existing.qty : '',
  note: existing?.note || '',
});

/**
 * Retur pembelian: /purchase-return/new (?gr=) atau /:id
 *   Draft: qty retur per baris GR, alasan, penyelesaian (potong tagihan / minta ganti); Post (izin post) = stok keluar
 *   Cancel: pembalik (stok kembali, tagihan & PO dikembalikan)
 */
export default function PurchaseReturnDetail() {
  const { id } = useParams();
  const isNew = id === 'new';
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const perm = usePermission('purchaseReturn');
  const canSeeCost = usePermission('vendorPrice').canView;
  const billPerm = usePermission('purchaseInvoice');
  const toast = useToast();
  const confirm = useConfirm();

  const [doc, setDoc] = useState(null);
  const [gr, setGr] = useState(null);
  const [form, setForm] = useState(null);
  const [lines, setLines] = useState([]);
  const [notFound, setNotFound] = useState(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState(false);
  const [version, setVersion] = useState(0);

  const startFromGr = useCallback(async (grId) => {
    try {
      const g = await getGrForReturn(grId, user.token);
      setGr(g);
      setForm({ date: toDateInput(), reason: '', resolution: 'CREDIT', note: '' });
      setLines(g.lines.filter((l) => l.returnable > 0).map((l) => lineFromGr(l)));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load goods receipt');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.token]);

  const load = useCallback(async () => {
    try {
      const d = await getPurchaseReturn(id, user.token);
      setDoc(d);
      setForm({ date: toDateInput(d.date), reason: d.reason || '', resolution: d.resolution, note: d.note || '' });
      if (d.status === 'DRAFT') {
        const g = await getGrForReturn(d.goodsReceipt._id, user.token);
        setGr(g);
        const byLine = new Map(d.lines.map((l) => [String(l.poLine), l]));
        setLines(g.lines.filter((l) => l.returnable > 0 || byLine.has(String(l.poLine))).map((l) => lineFromGr(l, byLine.get(String(l.poLine)))));
      } else {
        setGr(null);
        setLines(d.lines.map((l) => ({
          poLine: String(l.poLine), sku: l.sku?.sku, produkName: l.produk?.name || '', variant: variantLabel(l.sku), uom: l.uomBeli?.code || '',
          baseUom: l.produk?.uom?.code || '', konversi: l.konversi, received: l.received, returned: l.returned, returnable: l.returnable,
          unitAmount: l.qty && l.amount !== undefined ? l.amount / l.qty : null, qty: l.qty, note: l.note || '', amount: l.amount,
        })));
      }
      setVersion((v) => v + 1);
    } catch (err) {
      const s = err.response?.status;
      if ([400, 403, 404].includes(s)) setNotFound(err.response?.data?.message || 'Not found');
      else console.error(err);
    }
  }, [id, user.token]);

  useEffect(() => {
    if (!isNew) {
      load();
      return;
    }
    setDoc(null);
    setGr(null);
    setForm(null);
    setLines([]);
    const grId = searchParams.get('gr');
    if (grId) startFromGr(grId);
  }, [isNew, load, searchParams, startFromGr]);

  const status = isNew ? 'DRAFT' : doc?.status;
  const isDraft = status === 'DRAFT';
  const editable = isNew ? perm.canCreate : isDraft && perm.canUpdate;
  const setLine = (poLine, patch) => setLines((prev) => prev.map((l) => (l.poLine === poLine ? { ...l, ...patch } : l)));
  const filled = lines.filter((l) => l.qty !== '' && Number(l.qty) > 0);
  const total = round2(filled.reduce((s, l) => s + (l.amount ?? (l.unitAmount || 0) * Number(l.qty)), 0));
  const header = doc || gr;

  const payload = () => ({
    goodsReceipt: gr?._id || doc?.goodsReceipt?._id, ...form,
    lines: filled.map((l) => ({ poLine: l.poLine, qty: l.qty, note: l.note })),
  });
  const validate = () => {
    if (!form.reason.trim()) return 'Isi alasan retur.';
    if (!filled.length) return 'Isi qty retur minimal 1 baris.';
    const over = filled.find((l) => Number(l.qty) > l.returnable);
    if (over) return `${over.sku}: maksimal ${formatNumber(over.returnable)}.`;
    return null;
  };

  const save = async ({ post = false } = {}) => {
    const error = validate();
    if (error) return toast.warning(error);
    if (post) {
      const ok = await confirm({
        title: 'Post purchase return?',
        message: `${filled.length} barang keluar dari gudang ${header?.gudang?.code || ''}. `
          + (form.resolution === 'REPLACE' ? 'PO terbuka lagi untuk barang pengganti; ' : '')
          + 'hutang ke vendor berkurang (atau qty yang nanti ditagih berkurang).',
        confirmLabel: 'Save & Post',
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const res = isNew ? await createPurchaseReturn(payload(), user.token) : await updatePurchaseReturn(id, payload(), user.token);
      const saved = res.data.data;
      if (post) {
        const p = await postPurchaseReturn(saved._id, user.token);
        toast.success(p.data.message);
      } else toast.success(res.data.message);
      if (isNew) navigate(`/purchase-return/${saved._id}`, { replace: true });
      else await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save purchase return');
      if (!isNew) await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({ title: `Delete ${doc.no}?`, message: 'Draft ini akan dihapus permanen.', confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
    try {
      const res = await deletePurchaseReturn(id, user.token);
      toast.success(res.data.message);
      navigate('/purchase-return');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete');
    }
  };

  const cancel = async (reason) => {
    setBusy(true);
    try {
      const res = await cancelPurchaseReturn(id, reason, user.token);
      toast.success(res.data.message);
      setPanel(false);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to cancel');
    } finally {
      setBusy(false);
    }
  };

  if (notFound) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <p className="text-xl font-semibold text-fg mb-1">Purchase return not available</p>
        <p className="text-muted mb-6">{notFound}</p>
        <Link to="/purchase-return" className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded"><i className="fa fa-arrow-left"></i> Back</Link>
      </div>
    );
  }
  if (isNew && !gr) {
    return (
      <div className="h-full p-4 flex flex-col overflow-auto">
        <PageHeader fallbackTitle="Purchase Return" parentPath="/purchase-return" title="New Purchase Return" />
        <GrSelect token={user.token} onSelect={(grId) => navigate(`/purchase-return/new?gr=${grId}`, { replace: true })} />
      </div>
    );
  }
  if (!form) return <div className="p-6 text-muted">Loading...</div>;
  const grRef = doc?.goodsReceipt || gr;
  const bill = doc?.purchaseInvoice || gr?.purchaseInvoice;

  return (
    <div className="h-full p-4 flex flex-col overflow-auto">
      <PageHeader
        fallbackTitle="Purchase Return"
        parentPath="/purchase-return"
        title={doc?.no || 'New Purchase Return'}
        subtitle={[grRef?.no, header?.vendor?.companyName].filter(Boolean).join(' · ')}
        actions={(
          <>
            {!isNew && <StatusBadge status={status} meta={GR_STATUS_META} />}
            {isDraft && !isNew && perm.canDelete && <button type="button" onClick={remove} disabled={busy} className={btnDanger}><i className="fa fa-trash"></i> Delete</button>}
            {editable && <button type="button" onClick={() => save()} disabled={busy} className={btnGhost}><i className="fa fa-save"></i> Save draft</button>}
            {editable && perm.canPost && <button type="button" onClick={() => save({ post: true })} disabled={busy} className={btnPrimary}><i className="fa fa-check"></i> Save & Post</button>}
            {status === 'POSTED' && perm.canPost && (
              <button type="button" onClick={() => setPanel((p) => !p)} disabled={busy} className={btnDanger}><i className="fa fa-ban"></i> Cancel</button>
            )}
          </>
        )}
      />
      {panel && (
        <ReasonPanel title={`Cancel ${doc.no}`} confirmLabel="Cancel return" busy={busy} onConfirm={cancel} onClose={() => setPanel(false)}
          description="Barang masuk kembali ke gudang; potongan tagihan dibatalkan; untuk 'minta ganti', PO kembali seperti semula (ditolak jika barang pengganti sudah diterima)." />
      )}

      <div className="grid gap-4 items-start xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4 min-w-0">
          <section className="rounded-lg border border-line bg-surface p-4">
            <fieldset disabled={!editable || busy} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <FormField label="Return date" htmlFor="prt-date" required>
                <input id="prt-date" type="date" max={toDateInput()} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className={inputClass} />
              </FormField>
              <div className="sm:col-span-1 lg:col-span-3">
                <FormField label="Reason" htmlFor="prt-reason" required>
                  <input id="prt-reason" value={form.reason} maxLength={500} placeholder="mis. rusak, salah kirim, kedaluwarsa"
                    onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} className={inputClass} />
                </FormField>
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <FormField label="Resolution" htmlFor="prt-res">
                  <div id="prt-res" className="grid gap-2 sm:grid-cols-2">
                    {Object.entries(RETURN_RESOLUTIONS).map(([k, r]) => (
                      <label key={k} className={`flex items-start gap-2 px-3 py-2 rounded border text-sm cursor-pointer ${form.resolution === k ? 'border-primary bg-primary-soft text-primary-soft-fg' : 'border-line'}`}>
                        <input type="radio" name="prt-res" value={k} checked={form.resolution === k} onChange={() => setForm((f) => ({ ...f, resolution: k }))} className="mt-1 accent-primary" />
                        <span><b>{r.label}</b><span className="block text-xs opacity-80">{r.hint}</span></span>
                      </label>
                    ))}
                  </div>
                </FormField>
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <FormField label="Note" htmlFor="prt-note">
                  <input id="prt-note" value={form.note} maxLength={500} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className={inputClass} />
                </FormField>
              </div>
            </fieldset>
          </section>

          <section className="rounded-lg border border-line bg-surface">
            <div className="px-4 py-3 border-b border-line">
              <h3 className="font-semibold text-fg">Items</h3>
              <p className="text-xs text-muted">Qty dalam satuan beli GR; keluar dari stok dalam satuan dasar. Maksimal = diterima − sudah diretur.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: 820 }}>
                <thead className="bg-head text-head-fg text-left">
                  <tr>
                    <th className={th}>SKU</th>
                    <th className={`${th} w-24 text-right`}>Received</th>
                    <th className={`${th} w-24 text-right`}>Returned</th>
                    <th className={`${th} w-32 text-right`}>Return qty</th>
                    <th className={`${th} w-28 text-right`}>From stock</th>
                    {canSeeCost && <th className={`${th} w-32 text-right`} title="Harga PO setelah diskon + PPN">Value</th>}
                    <th className={`${th} w-44`}>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const q = l.qty === '' ? 0 : Number(l.qty);
                    const over = isDraft && q > l.returnable;
                    return (
                      <tr key={l.poLine} className={over ? 'bg-danger-soft' : 'hover:bg-subtle'}>
                        <td className={td}><div className="font-mono text-xs font-semibold">{l.sku}</div><div className="text-xs text-muted">{l.produkName} · {l.variant}</div></td>
                        <td className={`${td} text-right tabular-nums`}>{l.received === null || l.received === undefined ? '-' : `${formatNumber(l.received)} ${l.uom}`}</td>
                        <td className={`${td} text-right tabular-nums text-muted`}>{l.returned === null || l.returned === undefined ? '-' : formatNumber(l.returned)}</td>
                        <td className={`${td} text-right`}>
                          {editable ? (
                            <input aria-label={`Return ${l.sku}`} type="number" min="0" max={l.returnable} step="0.01" value={l.qty}
                              onChange={(e) => setLine(l.poLine, { qty: e.target.value })} className={`${cellInput} text-right tabular-nums`} />
                          ) : <span className="tabular-nums font-medium">{formatNumber(l.qty)} {l.uom}</span>}
                          {over && <div className="text-[10px] text-danger">maks. {formatNumber(l.returnable)}</div>}
                        </td>
                        <td className={`${td} text-right tabular-nums`}>{q ? `${formatNumber(round2(q * l.konversi))} ${l.baseUom}` : '-'}</td>
                        {canSeeCost && <td className={`${td} text-right tabular-nums`}>{q ? formatRupiah(l.amount ?? round2((l.unitAmount || 0) * q)) : '-'}</td>}
                        <td className={td}>
                          <input aria-label={`Note ${l.sku}`} value={l.note} maxLength={200} disabled={!editable || busy}
                            onChange={(e) => setLine(l.poLine, { note: e.target.value })} className={cellInput} />
                        </td>
                      </tr>
                    );
                  })}
                  {!lines.length && <tr><td colSpan={7} className="text-center py-8 text-muted">Semua barang di GR ini sudah diretur.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-line text-sm">
              {editable && lines.length > 0 && (
                <div className="flex gap-2">
                  <button type="button" onClick={() => setLines((p) => p.map((l) => ({ ...l, qty: l.returnable })))} className="px-3 py-1.5 rounded border border-line hover:bg-subtle cursor-pointer">Fill all</button>
                  <button type="button" onClick={() => setLines((p) => p.map((l) => ({ ...l, qty: '' })))} className="px-3 py-1.5 rounded border border-line hover:bg-subtle cursor-pointer">Clear</button>
                </div>
              )}
              <span className="ml-auto">
                {filled.length} item{canSeeCost && <> · nilai <b className="tabular-nums">{formatRupiah(doc && !isDraft ? doc.total : total)}</b></>}
              </span>
            </div>
          </section>
        </div>

        <aside className="space-y-4 min-w-0">
          <section className="rounded-lg border border-line bg-surface p-4 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
              <dt className="text-muted">Goods receipt</dt>
              <dd><Link to={`/goods-receipt/${grRef?._id}`} className="font-mono text-xs font-semibold text-primary hover:underline">{grRef?.no}</Link></dd>
              <dt className="text-muted">PO</dt>
              <dd>
                <span className="font-mono text-xs">{header?.purchaseOrder?.no}</span>
                {header?.purchaseOrder?.status && <span className="ml-1.5"><StatusBadge status={header.purchaseOrder.status} meta={PO_STATUS_META} /></span>}
              </dd>
              <dt className="text-muted">Vendor</dt><dd>{header?.vendor?.companyName}</dd>
              <dt className="text-muted">Warehouse</dt><dd>{header?.gudang?.code} — {header?.gudang?.name}</dd>
              <dt className="text-muted">Vendor bill</dt>
              <dd>
                {bill && bill.status !== 'CANCELLED'
                  ? (billPerm.canView ? <Link to={`/purchase-invoice/${bill._id}`} className="font-mono text-xs font-semibold text-primary hover:underline">{bill.no}</Link> : <span className="font-mono text-xs">{bill.no}</span>)
                  : <span className="text-xs text-muted">Belum ditagih: qty retur tidak ikut ditagih nanti</span>}
              </dd>
              {doc?.postedDate && (<><dt className="text-muted">Posted</dt><dd>{formatDate2(doc.postedDate)} · {doc.postedBy?.name || '-'}</dd></>)}
              {doc?.cancelledDate && (<><dt className="text-muted">Cancelled</dt><dd>{formatDate2(doc.cancelledDate)} · {doc.cancelledBy?.name || '-'}<div className="text-xs">{doc.cancelReason}</div></dd></>)}
            </dl>
          </section>
          {doc && (
            <section className="rounded-lg border border-line bg-surface p-4">
              <h3 className="font-semibold text-fg mb-2">History</h3>
              <AuditTimeline entity="purchaseReturn" id={doc._id} refreshKey={version} />
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
