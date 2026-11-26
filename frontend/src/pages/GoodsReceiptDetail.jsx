import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  getGoodsReceipt,
  getPoForReceipt,
  getReceivablePos,
  createGoodsReceipt,
  updateGoodsReceipt,
  deleteGoodsReceipt,
  postGoodsReceipt,
  cancelGoodsReceipt,
} from '../services/purchaseService';
import { useAuth } from '../context/AuthContext';
import { getVendorDropdown } from '../services/vendorService';
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
import { GR_STATUS_META, PO_STATUS_META, allocateFreight } from '../utils/purchaseMeta';

const cellInput = `w-full bg-input text-fg border border-line rounded px-2 py-1 text-sm
  focus:outline-none focus:border-primary disabled:bg-transparent disabled:border-transparent`;
const btn = 'px-4 py-2 rounded text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
const btnGhost = `${btn} border border-line hover:bg-subtle`;
const btnPrimary = `${btn} bg-primary hover:bg-primary-hover text-primary-fg`;
const btnDanger = `${btn} border border-danger-line text-danger hover:bg-danger-soft`;

// baris form dari baris PO (+ isian GR jika ada)
const lineFromPo = (pl, grLine) => ({
  poLine: pl._id,
  sku: pl.sku?.sku ?? '(deleted SKU)',
  produkName: pl.produk?.name || '',
  variant: variantLabel(pl.sku),
  baseUom: pl.produk?.uom?.code || '',
  uom: pl.uomBeli?.code || '',
  konversi: pl.konversi,
  ordered: pl.qty,
  received: pl.qtyReceived || 0,
  outstanding: pl.outstanding,
  unitCost: pl.unitCost,
  qty: grLine ? grLine.qty : '',
  note: grLine?.note || '',
});

// baris GR yang sudah diposting / dibatalkan (dari dokumen GR saja)
const lineFromGr = (l) => ({
  poLine: l.poLine,
  sku: l.sku?.sku ?? '(deleted SKU)',
  produkName: l.produk?.name || '',
  variant: variantLabel(l.sku),
  baseUom: l.produk?.uom?.code || '',
  uom: l.uomBeli?.code || '',
  konversi: l.konversi,
  ordered: l.ordered,
  received: l.received,
  outstanding: l.outstanding,
  unitCost: l.unitCost,
  freightCost: l.freightCost || 0,
  qty: l.qty,
  note: l.note || '',
});

const toPayload = (form, lines) => ({
  purchaseOrder: form.purchaseOrder,
  date: form.date,
  deliveryNoteNo: form.deliveryNoteNo,
  note: form.note,
  // biaya angkut hanya dikirim user dengan akses biaya (lainnya: nilai lama dipertahankan backend)
  ...(form.freightCharge === undefined ? {} : { freightCharge: form.freightCharge || 0, freightNote: form.freightNote, freightVendor: form.freightVendor || null }),
  lines: lines.filter((l) => l.qty !== '' && Number(l.qty) !== 0).map((l) => ({ poLine: l.poLine, qty: l.qty, note: l.note })),
});

/** Pilih PO yang bisa diterima (OPEN / PARTIAL) */
function PoSelect({ token, onSelect }) {
  const [search, setSearch] = useState('');
  const [list, setList] = useState([]);
  useEffect(() => {
    const t = setTimeout(() => getReceivablePos(token, search).then(setList).catch(console.error), 300);
    return () => clearTimeout(t);
  }, [token, search]);
  return (
    <section className="rounded-lg border border-line bg-surface p-4 space-y-3 max-w-3xl">
      <div>
        <h3 className="font-semibold text-fg">Pilih Purchase Order</h3>
        <p className="text-sm text-muted">Penerimaan barang wajib dari PO yang masih terbuka (Open / Partially received).</p>
      </div>
      <input type="search" aria-label="Search PO" placeholder="Cari nomor PO..." value={search}
        onChange={(e) => setSearch(e.target.value)} className={inputClass} autoFocus />
      <ul className="divide-y divide-line-soft border border-line rounded">
        {list.map((po) => (
          <li key={po._id}>
            <button type="button" onClick={() => onSelect(po._id)} className="w-full text-left px-3 py-2 hover:bg-subtle cursor-pointer flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="font-mono text-sm font-semibold text-primary">{po.no}</span>
              <span className="text-sm">{po.vendor?.companyName}</span>
              <span className="text-xs text-muted">{po.gudang?.code} · {formatDay(po.date)}{po.expectedDate ? ` · ETA ${formatDay(po.expectedDate)}` : ''}</span>
              <span className="ml-auto"><StatusBadge status={po.status} meta={PO_STATUS_META} /></span>
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="px-3 py-3 text-sm text-muted">Tidak ada PO terbuka.</li>}
      </ul>
    </section>
  );
}

/**
 * Goods Receipt: /goods-receipt/:id (id = 'new', ?po=<poId>)
 *   Draft : qty diterima per baris PO (default = sisa), Save draft / Save & Post (izin post)
 *   Post  : stok gudang PO bertambah + HPP dihitung ulang; opsional perbarui harga vendor
 *   Cancel: dibalik dengan movement pembalik (izin post), wajib alasan
 */
export default function GoodsReceiptDetail() {
  const { id } = useParams();
  const isNew = id === 'new';
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const perm = usePermission('goodsReceipt');
  const poPerm = usePermission('purchaseOrder');
  const pricePerm = usePermission('vendorPrice');
  const movementPerm = usePermission('stockMovement');
  const toast = useToast();
  const confirm = useConfirm();

  const [doc, setDoc] = useState(null);
  const [po, setPo] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [form, setForm] = useState(null);
  const [lines, setLines] = useState([]);
  const [savedPayload, setSavedPayload] = useState(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [updatePrices, setUpdatePrices] = useState(false);

  const canSeeCost = pricePerm.canView;
  const retPerm = usePermission('purchaseReturn');
  const billPerm = usePermission('purchaseInvoice');
  const [vendorList, setVendorList] = useState([]);
  useEffect(() => {
    if (canSeeCost) getVendorDropdown(user.token).then(setVendorList).catch(console.error);
  }, [canSeeCost, user.token]);
  const canUpdatePrices = pricePerm.canCreate && pricePerm.canUpdate;

  // GR baru dari PO: semua baris PO yang masih punya sisa, qty default = sisa
  const startFromPo = useCallback(async (poId) => {
    try {
      const p = await getPoForReceipt(poId, user.token);
      if (!['OPEN', 'PARTIAL'].includes(p.status)) {
        toast.warning(`${p.no} tidak bisa menerima barang (status ${p.status}).`);
        return;
      }
      setPo(p);
      setForm({ purchaseOrder: p._id, date: toDateInput(), deliveryNoteNo: '', note: '', ...(canSeeCost ? { freightCharge: 0, freightNote: '', freightVendor: '' } : {}) });
      setLines(p.lines.filter((l) => l.outstanding > 0).map((l) => ({ ...lineFromPo(l), qty: l.outstanding })));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load purchase order');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.token]);

  const load = useCallback(async () => {
    try {
      const d = await getGoodsReceipt(id, user.token);
      const f = {
        purchaseOrder: d.purchaseOrder?._id, date: toDateInput(d.date), deliveryNoteNo: d.deliveryNoteNo || '', note: d.note || '',
        ...(d.canSeeCost ? { freightCharge: d.freightCharge || 0, freightNote: d.freightNote || '', freightVendor: d.freightVendor?._id || '' } : {}),
      };
      let ls;
      if (d.status === 'DRAFT') {
        // draft: tampilkan semua baris PO yang masih bisa diterima + isian draft
        const p = await getPoForReceipt(d.purchaseOrder._id, user.token);
        setPo(p);
        const byLine = new Map(d.lines.map((l) => [String(l.poLine), l]));
        ls = p.lines.filter((l) => l.outstanding > 0 || byLine.has(String(l._id))).map((l) => lineFromPo(l, byLine.get(String(l._id))));
      } else {
        setPo(null);
        ls = d.lines.map(lineFromGr);
      }
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

  useEffect(() => {
    if (!isNew) {
      load();
      return;
    }
    setDoc(null);
    setPo(null);
    setForm(null);
    setLines([]);
    setSavedPayload(null);
    const poId = searchParams.get('po');
    if (poId) startFromPo(poId);
  }, [isNew, load, searchParams, startFromPo]);

  const status = isNew ? 'DRAFT' : doc?.status;
  const isDraft = status === 'DRAFT';
  const editable = isNew ? perm.canCreate : isDraft && perm.canUpdate;
  const payload = form ? toPayload(form, lines) : null;
  const dirty = editable && (isNew ? true : JSON.stringify(payload) !== savedPayload);

  const setLine = (poLine, patch) => setLines((prev) => prev.map((l) => (l.poLine === poLine ? { ...l, ...patch } : l)));

  // HPP per baris termasuk biaya angkut: draft dihitung di sini (harga PO + bagian angkut), posted dari dokumen
  const costed = useMemo(() => {
    if (!isDraft) return new Map(lines.map((l) => [l.poLine, l]));
    const filled = lines.filter((l) => l.qty !== '' && Number(l.qty) > 0)
      .map((l) => ({ ...l, qtyBase: round2(Number(l.qty) * l.konversi), baseUnitCost: l.unitCost || 0 }));
    return new Map(allocateFreight(filled, form?.freightCharge || 0).map((l) => [l.poLine, l]));
  }, [lines, isDraft, form?.freightCharge]);

  const summary = useMemo(() => {
    const filled = lines.filter((l) => l.qty !== '' && Number(l.qty) > 0);
    const over = lines.filter((l) => isDraft && l.qty !== '' && Number(l.qty) > l.outstanding);
    const value = round2(filled.reduce((sum, l) => sum + Number(l.qty) * l.konversi * (costed.get(l.poLine)?.unitCost ?? l.unitCost ?? 0), 0));
    return { filled: filled.length, over: over.length, value };
  }, [lines, isDraft, costed]);

  // ---------- aksi ----------
  const validate = () => {
    if (!summary.filled) return 'Isi qty diterima minimal untuk 1 item.';
    if (summary.over) return `${summary.over} item melebihi sisa PO. Barang lebih dari pesanan tidak bisa diterima.`;
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
      const res = isNew ? await createGoodsReceipt(payload, user.token) : await updateGoodsReceipt(id, payload, user.token);
      if (!quiet) toast.success(res.data.message);
      const savedId = res.data.data._id;
      if (isNew && !stay) navigate(`/goods-receipt/${savedId}`, { replace: true });
      else if (!isNew && !stay) await load();
      return savedId;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save goods receipt');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const post = async () => {
    const error = validate();
    if (error) return toast.warning(error);
    const ok = await confirm({
      title: `Post ${doc?.no || 'goods receipt'}?`,
      message: `${summary.filled} item akan masuk ke stok gudang ${po?.gudang?.code || doc?.gudang?.code || ''} dan HPP dihitung ulang.`
        + `${updatePrices ? ' Daftar harga vendor juga diperbarui dari harga PO.' : ''} Setelah diposting hanya bisa dibatalkan.`,
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
      const res = await postGoodsReceipt(docId, updatePrices, user.token);
      toast.success(res.data.message);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to post goods receipt');
    } finally {
      setBusy(false);
      if (isNew) navigate(`/goods-receipt/${docId}`, { replace: true });
      else await load();
    }
  };

  const removeDraft = async () => {
    const ok = await confirm({ title: `Delete ${doc.no}?`, message: 'Draft penerimaan ini akan dihapus. Stok tidak terpengaruh.', confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
    try {
      const res = await deleteGoodsReceipt(id, user.token);
      toast.success(res.data.message);
      navigate('/goods-receipt');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete goods receipt');
    }
  };

  const cancelDoc = async (reason) => {
    setBusy(true);
    try {
      const res = await cancelGoodsReceipt(id, reason, user.token);
      toast.success(res.data.message);
      setCancelOpen(false);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to cancel goods receipt');
    } finally {
      setBusy(false);
    }
  };

  // ---------- render ----------
  if (notFound) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <p className="text-xl font-semibold text-fg mb-1">Goods receipt not found</p>
        <p className="text-muted mb-6">Draft mungkin sudah dihapus.</p>
        <Link to="/goods-receipt" className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded">
          <i className="fa fa-arrow-left"></i> Back to Goods Receipt
        </Link>
      </div>
    );
  }
  if (isNew && perm.loaded && !perm.canCreate) {
    return <div className="p-6 text-muted">You don&apos;t have permission to create goods receipts.</div>;
  }

  const header = (
    <PageHeader
      fallbackTitle="Goods Receipt"
      parentPath="/goods-receipt"
      title={doc?.no || 'New Goods Receipt'}
      subtitle={(po || doc) && [doc?.purchaseOrder?.no || po?.no, (po?.vendor || doc?.vendor)?.companyName].filter(Boolean).join(' · ')}
      actions={form && (
        <>
          {!isNew && <StatusBadge status={status} meta={GR_STATUS_META} />}
          {isDraft && !isNew && perm.canDelete && (
            <button type="button" onClick={removeDraft} disabled={busy} className={btnDanger}><i className="fa fa-trash"></i> Delete</button>
          )}
          {editable && (
            <button type="button" onClick={() => save()} disabled={busy || (!isNew && !dirty)} className={btnGhost}>
              <i className="fa fa-save"></i> Save draft
            </button>
          )}
          {isDraft && perm.canPost && (!isNew || perm.canCreate) && (
            <button type="button" onClick={post} disabled={busy || !summary.filled || (dirty && !editable)} className={btnPrimary}>
              <i className="fa fa-check-double"></i> {dirty ? 'Save & Post' : 'Post'}
            </button>
          )}
          {status === 'POSTED' && retPerm.canCreate && (
            <button type="button" onClick={() => navigate(`/purchase-return/new?gr=${doc._id}`)} disabled={busy} className={btnGhost}>
              <i className="fa fa-truck-arrow-right"></i> Return
            </button>
          )}
          {status === 'POSTED' && !doc.purchaseInvoice && billPerm.canCreate && canSeeCost && (
            <button type="button" onClick={() => navigate(`/purchase-invoice/new?vendor=${doc.vendor?._id}`)} disabled={busy} className={btnGhost}>
              <i className="fa fa-file-invoice-dollar"></i> Bill
            </button>
          )}
          {status === 'POSTED' && perm.canPost && (
            <button type="button" onClick={() => setCancelOpen((o) => !o)} disabled={busy} className={btnDanger}>
              <i className="fa fa-ban"></i> Cancel GR
            </button>
          )}
        </>
      )}
    />
  );

  if (isNew && !form) {
    return (
      <div className="h-full p-4 flex flex-col overflow-auto">
        {header}
        <PoSelect token={user.token} onSelect={(poId) => navigate(`/goods-receipt/new?po=${poId}`, { replace: true })} />
      </div>
    );
  }
  if (!form) return <div className="p-6 text-muted">Loading...</div>;

  const gudang = po?.gudang || doc?.gudang;

  return (
    <div className="h-full p-4 flex flex-col overflow-auto">
      {header}

      {cancelOpen && (
        <ReasonPanel
          title={`Cancel ${doc.no}`}
          description="Stok dikurangi kembali & HPP dihitung balik (movement pembalik), qty diterima di PO berkurang. Ditolak jika stok sekarang tidak cukup. Harga vendor yang sempat diperbarui tidak dikembalikan."
          confirmLabel="Cancel GR"
          busy={busy}
          onConfirm={cancelDoc}
          onClose={() => setCancelOpen(false)}
        />
      )}

      <div className={`grid gap-4 items-start ${doc ? 'xl:grid-cols-[minmax(0,1fr)_320px]' : ''}`}>
        <div className="space-y-4 min-w-0">
          <section className="rounded-lg border border-line bg-surface p-4">
            <fieldset disabled={!editable || busy} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <FormField label="Purchase Order">
                <div className="px-4 py-2 font-mono text-sm">
                  {poPerm.canView
                    ? <Link to={`/purchase-order/${form.purchaseOrder}`} className="text-primary hover:underline">{doc?.purchaseOrder?.no || po?.no}</Link>
                    : (doc?.purchaseOrder?.no || po?.no)}
                  <span className="ml-2 font-sans text-xs text-muted">→ {gudang?.code}</span>
                </div>
              </FormField>
              <FormField label="Receipt Date" htmlFor="gr-date" required>
                <input id="gr-date" type="date" max={toDateInput()} value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className={inputClass} />
              </FormField>
              <FormField label="Delivery Note No." htmlFor="gr-sj">
                <input id="gr-sj" value={form.deliveryNoteNo} placeholder="No. surat jalan vendor"
                  onChange={(e) => setForm((f) => ({ ...f, deliveryNoteNo: e.target.value }))} className={inputClass} />
              </FormField>
              <FormField label="Note" htmlFor="gr-note">
                <input id="gr-note" value={form.note} placeholder="Optional"
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className={inputClass} />
              </FormField>
              {canSeeCost && form.freightCharge !== undefined && (
                <>
                  <FormField label="Freight charge (Rp)" htmlFor="gr-freight"
                    hint="Biaya angkut kedatangan ini (tanpa PPN yang bisa dikreditkan); dibagi ke baris menurut nilai & menambah HPP.">
                    <input id="gr-freight" type="number" min="0" step="0.01" value={form.freightCharge}
                      onChange={(e) => setForm((f) => ({ ...f, freightCharge: e.target.value }))} className={inputClass} />
                  </FormField>
                  <FormField label="Freight billed by" htmlFor="gr-freight-vendor" hint="Vendor yang menagih biaya angkut (mis. ekspedisi). Kosong = vendor PO.">
                    <select id="gr-freight-vendor" value={form.freightVendor || ''} onChange={(e) => setForm((f) => ({ ...f, freightVendor: e.target.value }))} className={inputClass}>
                      <option value="">Vendor PO</option>
                      {vendorList.map((v) => <option key={v._id} value={v._id}>{v.companyName}</option>)}
                    </select>
                  </FormField>
                  <FormField label="Freight note" htmlFor="gr-freight-note">
                    <input id="gr-freight-note" value={form.freightNote} maxLength={200} placeholder="Ekspedisi / no. tagihan"
                      onChange={(e) => setForm((f) => ({ ...f, freightNote: e.target.value }))} className={inputClass} />
                  </FormField>
                </>
              )}
            </fieldset>
          </section>

          <section className="rounded-lg border border-line bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-line">
              <div>
                <h3 className="font-semibold text-fg">Items</h3>
                <p className="text-xs text-muted">
                  Qty dalam satuan beli PO; masuk stok dalam satuan dasar (qty x konversi). Kosongkan / 0 untuk item yang tidak datang.
                </p>
              </div>
              {editable && lines.length > 0 && (
                <div className="flex gap-2 text-sm">
                  <button type="button" onClick={() => setLines((p) => p.map((l) => ({ ...l, qty: l.outstanding })))} className="px-3 py-1.5 rounded border border-line hover:bg-subtle cursor-pointer">
                    Fill outstanding
                  </button>
                  <button type="button" onClick={() => setLines((p) => p.map((l) => ({ ...l, qty: '' })))} className="px-3 py-1.5 rounded border border-line hover:bg-subtle cursor-pointer">
                    Clear
                  </button>
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: canSeeCost ? 1000 : 860 }}>
                <thead className="bg-head text-head-fg text-left">
                  <tr>
                    <th className="px-2 py-2 border-b border-line font-semibold">SKU</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-24 text-right">Ordered</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-24 text-right">{isDraft ? 'Received' : 'Rcvd (PO)'}</th>
                    {isDraft && <th className="px-2 py-2 border-b border-line font-semibold w-24 text-right">Outstanding</th>}
                    <th className="px-2 py-2 border-b border-line font-semibold w-32 text-right">This receipt</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-28 text-right">To stock</th>
                    {canSeeCost && <th className="px-2 py-2 border-b border-line font-semibold w-32 text-right" title="HPP masuk per satuan dasar (harga PO + bagian biaya angkut)">Unit cost</th>}
                    <th className="px-2 py-2 border-b border-line font-semibold w-44">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, index) => {
                    const qty = l.qty === '' ? null : Number(l.qty);
                    const over = isDraft && qty !== null && qty > l.outstanding;
                    return (
                      <tr key={l.poLine} className={over ? 'bg-danger-soft' : 'hover:bg-subtle'}>
                        <td className="px-2 py-1.5 border-t border-line-soft">
                          <div className="font-mono text-xs font-semibold">{l.sku}</div>
                          <div className="text-xs text-muted truncate max-w-64">{l.produkName} · {l.variant}</div>
                        </td>
                        <td className="px-2 py-1.5 border-t border-line-soft text-right tabular-nums">{l.ordered === null ? '-' : `${formatNumber(l.ordered)} ${l.uom}`}</td>
                        <td className="px-2 py-1.5 border-t border-line-soft text-right tabular-nums text-muted">{l.received === null ? '-' : formatNumber(l.received)}</td>
                        {isDraft && <td className="px-2 py-1.5 border-t border-line-soft text-right tabular-nums">{formatNumber(l.outstanding)}</td>}
                        <td className="px-2 py-1.5 border-t border-line-soft text-right">
                          {editable ? (
                            <input
                              aria-label={`Received ${l.sku}`}
                              type="number"
                              min="0"
                              max={l.outstanding}
                              step="0.01"
                              data-qty-index={index}
                              value={l.qty}
                              disabled={busy}
                              onChange={(e) => setLine(l.poLine, { qty: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key !== 'Enter') return;
                                e.preventDefault();
                                document.querySelector(`[data-qty-index="${index + 1}"]`)?.focus();
                              }}
                              className={`${cellInput} text-right tabular-nums`}
                            />
                          ) : <span className="tabular-nums font-medium">{formatNumber(l.qty)} {l.uom}</span>}
                          {over && <div className="text-[10px] text-danger mt-0.5">melebihi sisa</div>}
                        </td>
                        <td className="px-2 py-1.5 border-t border-line-soft text-right tabular-nums">
                          {qty ? `${formatNumber(round2(qty * l.konversi))} ${l.baseUom}` : '-'}
                        </td>
                        {canSeeCost && (
                          <td className="px-2 py-1.5 border-t border-line-soft text-right tabular-nums">
                            {formatRupiah(costed.get(l.poLine)?.unitCost ?? l.unitCost)}
                            {(costed.get(l.poLine)?.freightCost || 0) > 0 && (
                              <div className="text-[10px] text-muted">angkut {formatRupiah(costed.get(l.poLine).freightCost)}</div>
                            )}
                          </td>
                        )}
                        <td className="px-2 py-1.5 border-t border-line-soft">
                          {editable ? (
                            <input aria-label={`Note ${l.sku}`} value={l.note} maxLength={200} disabled={busy}
                              onChange={(e) => setLine(l.poLine, { note: e.target.value })} className={cellInput} />
                          ) : <span className="text-muted">{l.note}</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {lines.length === 0 && (
                    <tr><td colSpan={8} className="text-center py-8 text-muted">Semua item PO ini sudah diterima.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-line text-sm">
              <span>
                {summary.filled} item diterima
                {canSeeCost && <> · nilai persediaan masuk <b className="tabular-nums">{formatRupiah(summary.value)}</b></>}
                {canSeeCost && Number(form?.freightCharge) > 0 && <span className="text-muted"> (termasuk angkut {formatRupiah(form.freightCharge)})</span>}
                {summary.over > 0 && <span className="ml-2 text-danger"><i className="fa fa-triangle-exclamation mr-1"></i>{summary.over} item melebihi sisa PO</span>}
              </span>
              {isDraft && perm.canPost && canUpdatePrices && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={updatePrices} onChange={(e) => setUpdatePrices(e.target.checked)} className="w-4 h-4 accent-primary" />
                  Perbarui daftar harga vendor dari harga PO saat Post
                </label>
              )}
            </div>
          </section>
        </div>

        {doc && (
        <aside className="space-y-4 min-w-0">
          {doc && (
            <section className="rounded-lg border border-line bg-surface p-4 text-sm space-y-2">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                <dt className="text-muted">Status</dt><dd><StatusBadge status={doc.status} meta={GR_STATUS_META} /></dd>
                <dt className="text-muted">Warehouse</dt><dd>{doc.gudang?.code} — {doc.gudang?.name}</dd>
                {doc.postedDate && (<><dt className="text-muted">Posted</dt><dd>{formatDate2(doc.postedDate)} · {doc.postedBy?.name || '-'}</dd></>)}
                {doc.status === 'POSTED' && canSeeCost && (
                  <>
                    <dt className="text-muted">Vendor bill</dt>
                    <dd>
                      {doc.purchaseInvoice
                        ? (billPerm.canView ? <Link to={`/purchase-invoice/${doc.purchaseInvoice._id}`} className="font-mono text-xs font-semibold text-primary hover:underline">{doc.purchaseInvoice.no}</Link> : <span className="font-mono text-xs">{doc.purchaseInvoice.no}</span>)
                        : <span className="text-xs px-1.5 py-0.5 rounded bg-warning-soft text-warning-fg">Belum ditagih</span>}
                    </dd>
                  </>
                )}
                {canSeeCost && doc.freightCharge > 0 && (
                  <>
                    <dt className="text-muted">Freight</dt>
                    <dd>
                      {formatRupiah(doc.freightCharge)} · {doc.freightVendor?.companyName || doc.vendor?.companyName}
                      <div className="text-xs">
                        {doc.freightInvoice
                          ? <Link to={`/purchase-invoice/${doc.freightInvoice._id}`} className="font-mono text-primary hover:underline">{doc.freightInvoice.no}</Link>
                          : doc.status === 'POSTED' && <span className="text-warning-fg">belum ditagih</span>}
                      </div>
                    </dd>
                  </>
                )}
                {doc.returns?.length > 0 && (
                  <>
                    <dt className="text-muted">Returns</dt>
                    <dd className="space-y-0.5">
                      {doc.returns.map((r) => (
                        <div key={r._id}>
                          <Link to={`/purchase-return/${r._id}`} className="font-mono text-xs font-semibold text-primary hover:underline">{r.no}</Link>
                          <span className="text-xs text-muted"> · {GR_STATUS_META[r.status]?.label}</span>
                        </div>
                      ))}
                    </dd>
                  </>
                )}
                {doc.cancelledDate && (<><dt className="text-muted">Cancelled</dt><dd>{formatDate2(doc.cancelledDate)} · {doc.cancelledBy?.name || '-'}</dd></>)}
                {doc.cancelReason && (<><dt className="text-muted">Reason</dt><dd className="break-words">{doc.cancelReason}</dd></>)}
              </dl>
              {doc.status !== 'DRAFT' && movementPerm.canView && (
                <Link to={`/stock-movement?search=${encodeURIComponent(doc.no)}`} className="inline-block text-primary hover:underline">
                  <i className="fa fa-right-left mr-1"></i> View stock movements
                </Link>
              )}
            </section>
          )}
          {doc && <AuditDetail data={doc} />}
          {doc && (
            <section className="rounded-lg border border-line bg-surface p-4">
              <h3 className="font-semibold text-fg mb-2">History</h3>
              <AuditTimeline entity="goodsReceipt" id={doc._id} refreshKey={version} />
            </section>
          )}
        </aside>
        )}
      </div>
    </div>
  );
}
