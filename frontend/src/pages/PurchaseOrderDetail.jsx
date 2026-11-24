import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  getPurchaseOrder,
  createPurchaseOrder,
  updatePurchaseOrder,
  deletePurchaseOrder,
  issuePurchaseOrder,
  cancelPurchaseOrder,
  closePurchaseOrder,
  getSettings,
  searchPoItems,
} from '../services/purchaseService';
import { getVendorDropdown } from '../services/vendorService';
import { getMyGudangDropdown } from '../services/gudangService';
import { getUomDropdown } from '../services/uomService';
import { useAuth } from '../context/AuthContext';
import usePermission from '../hooks/usePermission';
import useToast from '../hooks/useToast';
import useConfirm from '../hooks/useConfirm';
import PageHeader from '../components/PageHeader';
import FormField from '../components/FormField';
import StatusBadge from '../components/stock/StatusBadge';
import ReasonPanel from '../components/stock/ReasonPanel';
import PoItemPicker from '../components/purchase/PoItemPicker';
import AuditTimeline from '../components/audit/AuditTimeline';
import { AuditDetail } from '../components/AuditInfo';
import { inputClass } from '../utils/formStyles';
import { formatNumber, formatRupiah, round2, variantLabel } from '../utils/formatHelper';
import { formatDate2, formatDay, toDateInput } from '../utils/dateHelper';
import { GR_STATUS_META, PO_STATUS_META, lineSubtotal } from '../utils/purchaseMeta';

const cellInput = `w-full bg-input text-fg border border-line rounded px-2 py-1 text-sm
  focus:outline-none focus:border-primary disabled:bg-transparent disabled:border-transparent`;
const btn = 'px-4 py-2 rounded text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
const btnGhost = `${btn} border border-line hover:bg-subtle`;
const btnPrimary = `${btn} bg-primary hover:bg-primary-hover text-primary-fg`;
const btnDanger = `${btn} border border-danger-line text-danger hover:bg-danger-soft`;

let keySeq = 0;
const newKey = () => `l${++keySeq}`;

const lineFromDoc = (l) => ({
  key: l._id,
  sku: { _id: l.sku?._id, sku: l.sku?.sku ?? '(deleted SKU)', produkName: l.produk?.name || '', variant: variantLabel(l.sku), baseUom: l.produk?.uom?.code || '' },
  prices: [],
  uomBeli: l.uomBeli?._id || '',
  konversi: l.konversi,
  qty: l.qty,
  hargaBeli: l.hargaBeli,
  diskonPersen: l.diskonPersen || 0,
  note: l.note || '',
  qtyReceived: l.qtyReceived || 0,
  outstanding: l.outstanding ?? null,
});

const lineFromItem = (item) => {
  const price = item.prices.find((p) => p.isPreferred) || item.prices[0];
  return {
    key: newKey(),
    sku: { _id: item._id, sku: item.sku, produkName: item.produk?.name || '', variant: item.variant, baseUom: item.baseUom?.code || '' },
    prices: item.prices,
    uomBeli: price?.uomBeli?._id || item.baseUom?._id || '',
    konversi: price?.konversi ?? 1,
    qty: price?.minOrder || '',
    hargaBeli: price?.hargaBeli ?? '',
    diskonPersen: 0,
    note: '',
    qtyReceived: 0,
    outstanding: null,
  };
};

const toPayload = (form, lines) => ({
  vendor: form.vendor,
  gudang: form.gudang,
  date: form.date,
  expectedDate: form.expectedDate || null,
  taxRate: form.taxRate,
  note: form.note,
  lines: lines.map((l) => ({
    sku: l.sku._id,
    uomBeli: l.uomBeli,
    konversi: l.konversi,
    qty: l.qty,
    hargaBeli: l.hargaBeli,
    diskonPersen: l.diskonPersen || 0,
    note: l.note,
  })),
});

const isBlank = (v) => v === '' || v === null || v === undefined;

/**
 * Purchase Order: /purchase-order/:id (id = 'new')
 *   Draft  : isi vendor, gudang, item (harga default dari daftar harga vendor), Save draft / Save & Issue
 *   Open   : tidak bisa diedit; Receive (buat Goods Receipt), Cancel (belum ada penerimaan)
 *   Partial: Receive, Close (sisa tidak akan datang)
 */
export default function PurchaseOrderDetail() {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const { user } = useAuth();
  const perm = usePermission('purchaseOrder');
  const grPerm = usePermission('goodsReceipt');
  const toast = useToast();
  const confirm = useConfirm();

  const [doc, setDoc] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [form, setForm] = useState(null);
  const [lines, setLines] = useState([]);
  const [savedPayload, setSavedPayload] = useState(null);
  const [options, setOptions] = useState({ vendors: [], gudangs: [], uoms: [] });
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [panel, setPanel] = useState(null); // 'cancel' | 'close'

  useEffect(() => {
    Promise.all([getVendorDropdown(user.token), getMyGudangDropdown(user.token), getUomDropdown(user.token)])
      .then(([vendors, gudangs, uoms]) => setOptions({ vendors, gudangs, uoms }))
      .catch(console.error);
  }, [user.token]);

  const load = useCallback(async () => {
    try {
      const d = await getPurchaseOrder(id, user.token);
      const f = {
        vendor: d.vendor?._id || '',
        gudang: d.gudang?._id || '',
        date: toDateInput(d.date),
        expectedDate: d.expectedDate ? toDateInput(d.expectedDate) : '',
        taxRate: d.taxRate,
        note: d.note || '',
      };
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

  useEffect(() => {
    if (!isNew) {
      load();
      return;
    }
    setDoc(null);
    setLines([]);
    setSavedPayload(null);
    setForm({ vendor: '', gudang: '', date: toDateInput(), expectedDate: '', taxRate: '', note: '' });
    // tarif PPN default dari System Settings
    getSettings(user.token)
      .then((s) => setForm((f) => (f && f.taxRate === '' ? { ...f, taxRate: s.values['tax.ppnRate'] ?? 0 } : f)))
      .catch(console.error);
  }, [isNew, load, user.token]);

  // gudang default untuk PO baru: satu-satunya gudang aktif / MAIN
  const activeGudang = options.gudangs.filter((g) => g.isActive !== false);
  useEffect(() => {
    if (!isNew || !form || form.gudang || !activeGudang.length) return;
    const def = activeGudang.length === 1 ? activeGudang[0] : activeGudang.find((g) => g.code === 'MAIN');
    if (def) setForm((f) => ({ ...f, gudang: def._id }));
  }, [isNew, form, activeGudang]);

  const status = isNew ? 'DRAFT' : doc?.status;
  const isDraft = status === 'DRAFT';
  const editable = isNew ? perm.canCreate : isDraft && perm.canUpdate;
  const payload = form ? toPayload(form, lines) : null;
  const dirty = editable && (isNew ? lines.length > 0 : JSON.stringify(payload) !== savedPayload);
  // draft yang dibuka ulang: muat daftar harga vendor untuk baris yang sudah ada (tanda ★ & isi otomatis)
  const pricesMissing = editable && !!form?.vendor && lines.some((l) => !l.prices.length);
  useEffect(() => {
    if (!pricesMissing || isNew) return;
    searchPoItems(user.token, { vendor: form.vendor })
      .then((items) => {
        const byId = new Map(items.map((i) => [i._id, i.prices]));
        setLines((prev) => prev.map((l) => (l.prices.length ? l : { ...l, prices: byId.get(l.sku._id) || [] })));
      })
      .catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedPayload]);

  const uomCode = (uomId) => options.uoms.find((u) => u._id === uomId)?.code || '';

  // ---------- baris ----------
  const addItem = (item) => {
    const line = lineFromItem(item);
    if (lines.some((l) => l.sku._id === line.sku._id && l.uomBeli === line.uomBeli)) {
      toast.info(`${item.sku} dengan satuan tersebut sudah ada. Ubah qty-nya, atau pilih satuan lain di baris baru.`);
    }
    setLines((prev) => [...prev, line]);
  };
  const setLine = (key, patch) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key) => setLines((prev) => prev.filter((l) => l.key !== key));

  // ganti satuan beli: ambil konversi & harga dari daftar harga vendor bila ada
  const changeUom = (l, uomId) => {
    const price = l.prices.find((p) => p.uomBeli?._id === uomId);
    if (price) setLine(l.key, { uomBeli: uomId, konversi: price.konversi, hargaBeli: price.hargaBeli });
    else if (uomCode(uomId) === l.sku.baseUom) setLine(l.key, { uomBeli: uomId, konversi: 1 });
    else setLine(l.key, { uomBeli: uomId });
  };

  const changeVendor = async (vendor) => {
    if (lines.length) {
      const ok = await confirm({
        title: 'Change vendor?',
        message: 'Harga di baris diambil dari daftar harga vendor sebelumnya. Semua baris akan dikosongkan.',
        confirmLabel: 'Change & clear lines',
        tone: 'danger',
      });
      if (!ok) return;
      setLines([]);
    }
    setForm((f) => ({ ...f, vendor }));
  };

  const totals = useMemo(() => {
    const subtotal = round2(lines.reduce((sum, l) => sum + (isBlank(l.qty) || isBlank(l.hargaBeli) ? 0 : lineSubtotal(l)), 0));
    const taxAmount = round2(subtotal * Number(form?.taxRate || 0) / 100);
    return { subtotal, taxAmount, total: round2(subtotal + taxAmount) };
  }, [lines, form?.taxRate]);

  // ---------- aksi ----------
  const validate = () => {
    if (!form.vendor) return 'Pilih vendor.';
    if (!form.gudang) return 'Pilih gudang tujuan.';
    if (!lines.length) return 'Tambahkan minimal 1 item.';
    const bad = lines.find((l) => !l.uomBeli || isBlank(l.qty) || Number(l.qty) <= 0 || isBlank(l.hargaBeli) || !(Number(l.konversi) > 0));
    if (bad) return `${bad.sku.sku}: lengkapi satuan, konversi, qty (> 0), dan harga.`;
    const keys = lines.map((l) => `${l.sku._id}:${l.uomBeli}`);
    if (new Set(keys).size !== keys.length) return 'Ada SKU dengan satuan yang sama lebih dari sekali. Gabungkan qty-nya.';
    return null;
  };

  const save = async (issue = false) => {
    const error = validate();
    if (error) return toast.warning(error);
    if (issue) {
      const ok = await confirm({
        title: 'Issue purchase order?',
        message: `PO ke ${options.vendors.find((v) => v._id === form.vendor)?.companyName || 'vendor'} senilai ${formatRupiah(totals.total)} akan diterbitkan. `
          + 'Setelah terbit, PO tidak bisa diedit (hanya dibatalkan / ditutup).',
        confirmLabel: 'Issue PO',
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const body = { ...payload, issue };
      const res = isNew ? await createPurchaseOrder(body, user.token) : await updatePurchaseOrder(id, body, user.token);
      toast.success(res.data.message);
      if (isNew) navigate(`/purchase-order/${res.data.data._id}`, { replace: true });
      else await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save purchase order');
    } finally {
      setBusy(false);
    }
  };

  const issueSaved = async () => {
    const ok = await confirm({
      title: `Issue ${doc.no}?`,
      message: 'Setelah terbit, PO tidak bisa diedit (hanya dibatalkan / ditutup).',
      confirmLabel: 'Issue PO',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await issuePurchaseOrder(id, user.token);
      toast.success(res.data.message);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to issue purchase order');
    } finally {
      setBusy(false);
    }
  };

  const removeDraft = async () => {
    const ok = await confirm({ title: `Delete ${doc.no}?`, message: 'Draft PO ini akan dihapus permanen.', confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
    try {
      const res = await deletePurchaseOrder(id, user.token);
      toast.success(res.data.message);
      navigate('/purchase-order');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete purchase order');
    }
  };

  const runReasonAction = async (reason) => {
    setBusy(true);
    try {
      const fn = panel === 'cancel' ? cancelPurchaseOrder : closePurchaseOrder;
      const res = await fn(id, reason, user.token);
      toast.success(res.data.message);
      setPanel(null);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  // ---------- render ----------
  if (notFound) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <p className="text-xl font-semibold text-fg mb-1">Purchase order not found</p>
        <p className="text-muted mb-6">Draft mungkin sudah dihapus.</p>
        <Link to="/purchase-order" className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded">
          <i className="fa fa-arrow-left"></i> Back to Purchase Order
        </Link>
      </div>
    );
  }
  if (!form) return <div className="p-6 text-muted">Loading...</div>;
  if (isNew && perm.loaded && !perm.canCreate) {
    return <div className="p-6 text-muted">You don&apos;t have permission to create purchase orders.</div>;
  }

  const canReceive = ['OPEN', 'PARTIAL'].includes(status) && grPerm.canCreate;
  const gudangOptions = options.gudangs.filter((g) => g.isActive !== false || g._id === form.gudang);
  const showReceived = !isDraft;

  return (
    <div className="h-full p-4 flex flex-col overflow-auto">
      <PageHeader
        fallbackTitle="Purchase Order"
        parentPath="/purchase-order"
        title={doc?.no || 'New Purchase Order'}
        subtitle={doc?.vendor?.companyName}
        actions={(
          <>
            {!isNew && <StatusBadge status={status} meta={PO_STATUS_META} />}
            {isDraft && !isNew && perm.canDelete && (
              <button type="button" onClick={removeDraft} disabled={busy} className={btnDanger}><i className="fa fa-trash"></i> Delete</button>
            )}
            {editable && (
              <button type="button" onClick={() => save(false)} disabled={busy || (!isNew && !dirty)} className={btnGhost}>
                <i className="fa fa-save"></i> Save draft
              </button>
            )}
            {editable && (
              <button type="button" onClick={() => (dirty || isNew ? save(true) : issueSaved())} disabled={busy || !lines.length} className={btnPrimary}>
                <i className="fa fa-paper-plane"></i> {dirty || isNew ? 'Save & Issue' : 'Issue'}
              </button>
            )}
            {status === 'OPEN' && perm.canUpdate && (
              <button type="button" onClick={() => setPanel(panel === 'cancel' ? null : 'cancel')} disabled={busy} className={btnDanger}>
                <i className="fa fa-ban"></i> Cancel PO
              </button>
            )}
            {status === 'PARTIAL' && perm.canUpdate && (
              <button type="button" onClick={() => setPanel(panel === 'close' ? null : 'close')} disabled={busy} className={btnGhost}>
                <i className="fa fa-lock"></i> Close PO
              </button>
            )}
            {canReceive && (
              <button type="button" onClick={() => navigate(`/goods-receipt/new?po=${id}`)} className={btnPrimary}>
                <i className="fa fa-truck-ramp-box"></i> Receive
              </button>
            )}
          </>
        )}
      />

      {panel === 'cancel' && (
        <ReasonPanel
          title={`Cancel ${doc.no}`}
          description="PO dibatalkan (belum ada barang diterima). PO yang dibatalkan tidak bisa diaktifkan lagi; buat PO baru bila perlu."
          confirmLabel="Cancel PO"
          busy={busy}
          onConfirm={runReasonAction}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'close' && (
        <ReasonPanel
          title={`Close ${doc.no}`}
          description="Sisa barang yang belum diterima dianggap tidak akan datang. PO tidak bisa menerima barang lagi."
          placeholder="Alasan, mis. vendor kehabisan stok (wajib)"
          confirmLabel="Close PO"
          icon="fa-lock"
          busy={busy}
          onConfirm={runReasonAction}
          onClose={() => setPanel(null)}
        />
      )}

      <div className={`grid gap-4 items-start ${doc ? 'xl:grid-cols-[minmax(0,1fr)_320px]' : ''}`}>
        <div className="space-y-4 min-w-0">
          <section className="rounded-lg border border-line bg-surface p-4">
            <fieldset disabled={!editable || busy} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <FormField label="Vendor" htmlFor="po-vendor" required>
                <select id="po-vendor" value={form.vendor} onChange={(e) => changeVendor(e.target.value)} className={inputClass}>
                  <option value="">— choose —</option>
                  {options.vendors.map((v) => <option key={v._id} value={v._id}>{v.companyName}</option>)}
                </select>
              </FormField>
              <FormField label="Destination Warehouse" htmlFor="po-gudang" required>
                <select id="po-gudang" value={form.gudang} onChange={(e) => setForm((f) => ({ ...f, gudang: e.target.value }))} className={inputClass}>
                  <option value="">— choose —</option>
                  {gudangOptions.map((g) => <option key={g._id} value={g._id}>{g.code} — {g.name}</option>)}
                </select>
              </FormField>
              <FormField label="PPN (%)" htmlFor="po-tax" hint={doc && !isDraft ? (doc.isPKP ? 'PKP: PPN tidak masuk HPP' : 'Non-PKP: PPN masuk HPP') : '0 = vendor non-PKP'}>
                <input id="po-tax" type="number" min="0" max="100" step="0.01" value={form.taxRate}
                  onChange={(e) => setForm((f) => ({ ...f, taxRate: e.target.value }))} className={inputClass} />
              </FormField>
              <FormField label="PO Date" htmlFor="po-date" required>
                <input id="po-date" type="date" max={toDateInput()} value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className={inputClass} />
              </FormField>
              <FormField label="Expected Date" htmlFor="po-expected">
                <input id="po-expected" type="date" min={form.date} value={form.expectedDate}
                  onChange={(e) => setForm((f) => ({ ...f, expectedDate: e.target.value }))} className={inputClass} />
              </FormField>
              <FormField label="Note" htmlFor="po-note">
                <input id="po-note" value={form.note} placeholder="Optional"
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className={inputClass} />
              </FormField>
            </fieldset>
          </section>

          <section className="rounded-lg border border-line bg-surface">
            <div className="px-4 py-3 border-b border-line">
              <h3 className="font-semibold text-fg">Items ({lines.length})</h3>
              <p className="text-xs text-muted">
                Qty & harga per satuan beli. Harga terisi dari daftar harga vendor dan bisa diubah. Maks. 2 desimal.
              </p>
            </div>
            {editable && (
              <div className="px-4 py-3 border-b border-line-soft bg-subtle">
                <PoItemPicker token={user.token} vendor={form.vendor} onAdd={addItem} />
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: showReceived ? 1080 : 980 }}>
                <thead className="bg-head text-head-fg text-left">
                  <tr>
                    <th className="px-2 py-2 border-b border-line font-semibold w-8 text-right">#</th>
                    <th className="px-2 py-2 border-b border-line font-semibold">SKU</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-28">UoM</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-24 text-right">Conv.</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-24 text-right">Qty</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-32 text-right">Price</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-20 text-right">Disc %</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-36 text-right">Subtotal</th>
                    {showReceived && <th className="px-2 py-2 border-b border-line font-semibold w-28 text-right">Received</th>}
                    <th className="px-2 py-2 border-b border-line font-semibold w-40">Note</th>
                    {editable && <th className="px-2 py-2 border-b border-line w-10"></th>}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, index) => {
                    const price = l.prices.find((p) => p.uomBeli?._id === l.uomBeli);
                    const belowMin = price?.minOrder && Number(l.qty) > 0 && Number(l.qty) < price.minOrder;
                    const priceDiff = price && !isBlank(l.hargaBeli) && Number(l.hargaBeli) !== price.hargaBeli;
                    const uomOptions = options.uoms;
                    const sub = isBlank(l.qty) || isBlank(l.hargaBeli) ? null : lineSubtotal(l);
                    const done = l.qtyReceived >= l.qty;
                    return (
                      <tr key={l.key} className="align-top hover:bg-subtle">
                        <td className="px-2 py-1.5 border-t border-line-soft text-right text-muted tabular-nums">{index + 1}</td>
                        <td className="px-2 py-1.5 border-t border-line-soft">
                          <div className="font-mono text-xs font-semibold">{l.sku.sku}</div>
                          <div className="text-xs text-muted truncate max-w-64">{l.sku.produkName} · {l.sku.variant}</div>
                        </td>
                        <td className="px-2 py-1.5 border-t border-line-soft">
                          {editable ? (
                            <select aria-label={`UoM ${l.sku.sku}`} value={l.uomBeli} disabled={busy}
                              onChange={(e) => changeUom(l, e.target.value)} className={`${cellInput} px-1`}>
                              <option value="">—</option>
                              {uomOptions.map((u) => (
                                <option key={u._id} value={u._id}>
                                  {u.code}{l.prices.some((p) => p.uomBeli?._id === u._id) ? ' ★' : ''}
                                </option>
                              ))}
                            </select>
                          ) : uomCode(l.uomBeli)}
                          {editable && <div className="text-[10px] text-muted mt-0.5">★ = ada harga vendor</div>}
                        </td>
                        <td className="px-2 py-1.5 border-t border-line-soft text-right">
                          {editable ? (
                            <input aria-label={`Conversion ${l.sku.sku}`} type="number" min="0.01" step="0.01" value={l.konversi} disabled={busy}
                              onChange={(e) => setLine(l.key, { konversi: e.target.value })} className={`${cellInput} text-right tabular-nums`} />
                          ) : <span className="tabular-nums">{formatNumber(l.konversi)}</span>}
                          <div className="text-[10px] text-muted mt-0.5">{l.sku.baseUom}</div>
                        </td>
                        <td className="px-2 py-1.5 border-t border-line-soft text-right">
                          {editable ? (
                            <input aria-label={`Qty ${l.sku.sku}`} type="number" min="0.01" step="0.01" value={l.qty} disabled={busy}
                              onChange={(e) => setLine(l.key, { qty: e.target.value })} className={`${cellInput} text-right tabular-nums`} />
                          ) : <span className="tabular-nums">{formatNumber(l.qty)}</span>}
                          {belowMin && <div className="text-[10px] text-warning-fg mt-0.5">min. order {formatNumber(price.minOrder)}</div>}
                        </td>
                        <td className="px-2 py-1.5 border-t border-line-soft text-right">
                          {editable ? (
                            <input aria-label={`Price ${l.sku.sku}`} type="number" min="0" step="0.01" value={l.hargaBeli} disabled={busy}
                              onChange={(e) => setLine(l.key, { hargaBeli: e.target.value })} className={`${cellInput} text-right tabular-nums`} />
                          ) : <span className="tabular-nums">{formatRupiah(l.hargaBeli)}</span>}
                          {editable && priceDiff && <div className="text-[10px] text-warning-fg mt-0.5">daftar: {formatRupiah(price.hargaBeli)}</div>}
                        </td>
                        <td className="px-2 py-1.5 border-t border-line-soft text-right">
                          {editable ? (
                            <input aria-label={`Discount ${l.sku.sku}`} type="number" min="0" max="100" step="0.01" value={l.diskonPersen} disabled={busy}
                              onChange={(e) => setLine(l.key, { diskonPersen: e.target.value })} className={`${cellInput} text-right tabular-nums`} />
                          ) : <span className="tabular-nums">{l.diskonPersen ? formatNumber(l.diskonPersen) : '-'}</span>}
                        </td>
                        <td className="px-2 py-1.5 border-t border-line-soft text-right tabular-nums font-medium">{sub === null ? '-' : formatRupiah(sub)}</td>
                        {showReceived && (
                          <td className={`px-2 py-1.5 border-t border-line-soft text-right tabular-nums ${done ? 'text-success-fg' : ''}`}>
                            {formatNumber(l.qtyReceived)} / {formatNumber(l.qty)}
                          </td>
                        )}
                        <td className="px-2 py-1.5 border-t border-line-soft">
                          {editable ? (
                            <input aria-label={`Note ${l.sku.sku}`} value={l.note} maxLength={200} disabled={busy}
                              onChange={(e) => setLine(l.key, { note: e.target.value })} className={cellInput} />
                          ) : <span className="text-muted">{l.note}</span>}
                        </td>
                        {editable && (
                          <td className="px-2 py-1.5 border-t border-line-soft text-center">
                            <button type="button" title="Remove line" aria-label={`Remove ${l.sku.sku}`} onClick={() => removeLine(l.key)}
                              className="w-8 h-8 rounded-md text-muted hover:text-danger hover:bg-danger-soft cursor-pointer">
                              <i className="fa fa-xmark"></i>
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={11} className="text-center py-8 text-muted">
                        Belum ada item.{editable && (form.vendor ? ' Cari SKU di atas.' : ' Pilih vendor dulu, lalu cari SKU.')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <dl className="ml-auto max-w-xs px-4 py-3 border-t border-line text-sm grid grid-cols-2 gap-y-1">
              <dt className="text-muted">Subtotal</dt><dd className="text-right tabular-nums">{formatRupiah(totals.subtotal)}</dd>
              <dt className="text-muted">PPN {formatNumber(form.taxRate || 0)}%</dt><dd className="text-right tabular-nums">{formatRupiah(totals.taxAmount)}</dd>
              <dt className="font-semibold">Total</dt><dd className="text-right tabular-nums font-semibold">{formatRupiah(totals.total)}</dd>
            </dl>
          </section>
        </div>

        {doc && (
        <aside className="space-y-4 min-w-0">
          {doc && (
            <section className="rounded-lg border border-line bg-surface p-4 text-sm">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                <dt className="text-muted">Status</dt><dd><StatusBadge status={doc.status} meta={PO_STATUS_META} /></dd>
                <dt className="text-muted">Tax</dt><dd>{doc.isPKP ? 'PKP' : 'Non-PKP'} · PPN {formatNumber(doc.taxRate)}%</dd>
                {doc.issuedDate && (<><dt className="text-muted">Issued</dt><dd>{formatDate2(doc.issuedDate)} · {doc.issuedBy?.name || '-'}</dd></>)}
                {doc.closedDate && (<><dt className="text-muted">Closed</dt><dd>{formatDate2(doc.closedDate)} · {doc.closedBy?.name || '-'}</dd></>)}
                {doc.closeReason && (<><dt className="text-muted">Reason</dt><dd className="break-words">{doc.closeReason}</dd></>)}
                {doc.cancelledDate && (<><dt className="text-muted">Cancelled</dt><dd>{formatDate2(doc.cancelledDate)} · {doc.cancelledBy?.name || '-'}</dd></>)}
                {doc.cancelReason && (<><dt className="text-muted">Reason</dt><dd className="break-words">{doc.cancelReason}</dd></>)}
              </dl>
            </section>
          )}
          {doc && doc.receipts?.length > 0 && (
            <section className="rounded-lg border border-line bg-surface p-4 text-sm">
              <h3 className="font-semibold text-fg mb-2">Goods Receipts</h3>
              <ul className="space-y-1.5">
                {doc.receipts.map((r) => (
                  <li key={r._id} className="flex items-center justify-between gap-2">
                    {grPerm.canView
                      ? <Link to={`/goods-receipt/${r._id}`} className="font-mono text-xs font-semibold text-primary hover:underline">{r.no}</Link>
                      : <span className="font-mono text-xs">{r.no}</span>}
                    <span className="text-xs text-muted">{formatDay(r.date)}</span>
                    <StatusBadge status={r.status} meta={GR_STATUS_META} />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {doc && <AuditDetail data={doc} />}
          {doc && (
            <section className="rounded-lg border border-line bg-surface p-4">
              <h3 className="font-semibold text-fg mb-2">History</h3>
              <AuditTimeline entity="purchaseOrder" id={doc._id} refreshKey={version} />
            </section>
          )}
        </aside>
        )}
      </div>
    </div>
  );
}
