import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  getStockTransfer,
  createStockTransfer,
  updateStockTransfer,
  deleteStockTransfer,
  sendStockTransfer,
  receiveStockTransfer,
  cancelStockTransfer,
  searchTransferSkus,
  getTransferSkuBalances,
} from '../services/stockService';
import { getGudangDropdown } from '../services/gudangService';
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
import { TRANSFER_STATUS_META } from '../utils/stockMeta';

const cellInput = `w-full bg-input text-fg border border-line rounded px-2 py-1 text-sm
  focus:outline-none focus:border-primary disabled:bg-transparent disabled:border-transparent`;
const btn = 'px-4 py-2 rounded text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
const btnGhost = `${btn} border border-line hover:bg-subtle`;
const btnPrimary = `${btn} bg-primary hover:bg-primary-hover text-primary-fg`;
const btnDanger = `${btn} border border-danger-line text-danger hover:bg-danger-soft`;

const isBlank = (v) => v === '' || v === null || v === undefined;

const lineFromDoc = (l) => ({
  sku: {
    _id: l.sku?._id ?? null,
    sku: l.sku?.sku ?? '(deleted SKU)',
    produkName: l.produk?.name || '',
    variant: variantLabel(l.sku),
    uom: l.produk?.uom?.code || '',
    isActive: l.sku?.isActive !== false,
  },
  qty: l.qty ?? '',
  qtyReceived: l.qtyReceived ?? null,
  receiveInput: l.qtyReceived ?? l.qty ?? '', // isian saat menerima (default = dikirim)
  note: l.note || '',
  currentQty: l.currentQty ?? null,
  unitCost: l.unitCost ?? null,
  value: l.value ?? null,
  lossValue: l.lossValue ?? 0,
});

const lineFromSearch = (s) => ({
  sku: { _id: s._id, sku: s.sku, produkName: s.produk?.name || '', variant: s.variant, uom: s.uom, isActive: s.isActive },
  qty: '',
  qtyReceived: null,
  receiveInput: '',
  note: '',
  currentQty: s.qty,
  unitCost: s.avgCost ?? null,
  value: null,
  lossValue: 0,
});

const toPayload = (form, lines) => ({
  fromGudang: form.fromGudang,
  toGudang: form.toGudang,
  date: form.date,
  note: form.note,
  lines: lines.map((l) => ({ sku: l.sku._id, qty: l.qty, note: l.note })),
});

/**
 * Stock Transfer: /stock-transfer/:id (id = 'new')
 *   Draft      : isi gudang asal (yang ditugaskan) & tujuan + baris, Save draft / Delete
 *   Send       : stok keluar dari gudang asal (izin post + akses gudang asal) -> In transit
 *   Receive    : isi jumlah diterima (default = dikirim) di gudang tujuan (izin post + akses gudang tujuan).
 *                Kurang = hilang/rusak di perjalanan, catatan wajib.
 *   Cancel     : selama In transit, stok kembali ke gudang asal (alasan wajib)
 */
export default function StockTransferDetail() {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const { user } = useAuth();
  const perm = usePermission('stockTransfer');
  const movementPerm = usePermission('stockMovement');
  const canSeeCost = usePermission('vendorPrice').canView;
  const toast = useToast();
  const confirm = useConfirm();

  const [doc, setDoc] = useState(null);
  const [notFound, setNotFound] = useState(null);
  const [form, setForm] = useState(null);
  const [lines, setLines] = useState([]);
  const [savedPayload, setSavedPayload] = useState(null);
  const [gudangList, setGudangList] = useState([]);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [receiveNote, setReceiveNote] = useState('');

  useEffect(() => {
    getGudangDropdown(user.token).then(setGudangList).catch(console.error);
  }, [user.token]);

  const applyDoc = useCallback((d) => {
    const f = { fromGudang: d.fromGudang?._id || '', toGudang: d.toGudang?._id || '', date: toDateInput(d.date), note: d.note || '' };
    const ls = d.lines.map(lineFromDoc);
    setDoc(d);
    setForm(f);
    setLines(ls);
    setSavedPayload(JSON.stringify(toPayload(f, ls)));
  }, []);

  const load = useCallback(async () => {
    try {
      applyDoc(await getStockTransfer(id, user.token));
      setVersion((v) => v + 1);
    } catch (err) {
      const s = err.response?.status;
      if ([400, 403, 404].includes(s)) setNotFound(s === 403 ? err.response?.data?.message : 'Transfer mungkin sudah dihapus.');
      else console.error(err);
    }
  }, [id, user.token, applyDoc]);

  useEffect(() => {
    if (!isNew) {
      load();
      return;
    }
    setDoc(null);
    setLines([]);
    setSavedPayload(null);
    setForm({ fromGudang: '', toGudang: '', date: toDateInput(), note: '' });
  }, [isNew, load]);

  // gudang asal = gudang yang ditugaskan; tujuan = gudang aktif mana pun
  const fromOptions = gudangList.filter((g) => g.accessible !== false && (g.isActive !== false || g._id === form?.fromGudang));
  const toOptions = gudangList.filter((g) => g._id !== form?.fromGudang && (g.isActive !== false || g._id === form?.toGudang));
  useEffect(() => {
    if (!isNew || !form || form.fromGudang) return;
    const active = gudangList.filter((g) => g.accessible !== false && g.isActive !== false);
    if (active.length === 1) setForm((f) => ({ ...f, fromGudang: active[0]._id }));
  }, [isNew, form, gudangList]);

  const status = isNew ? 'DRAFT' : doc?.status;
  const isDraft = status === 'DRAFT';
  const canSend = isNew || doc?.canSend !== false;      // akses gudang asal
  const canReceive = !!doc?.canReceive;                  // akses gudang tujuan
  const editable = canSend && (isNew ? perm.canCreate : isDraft && perm.canUpdate);
  const receiving = status === 'IN_TRANSIT' && perm.canPost && canReceive;
  const payload = form ? toPayload(form, lines) : null;
  const dirty = editable && (isNew ? lines.length > 0 : JSON.stringify(payload) !== savedPayload);
  const gudangCode = (gid) => gudangList.find((g) => g._id === gid)?.code || '';

  // ---------- baris ----------
  const existing = useMemo(() => new Set(lines.map((l) => l.sku._id)), [lines]);
  const addLines = (skus) => {
    const fresh = skus.filter((s) => !existing.has(s._id));
    if (!fresh.length) return toast.info('SKU tersebut sudah ada di transfer.');
    setLines((prev) => [...prev, ...fresh.map(lineFromSearch)]);
  };
  const setLine = (skuId, field, value) => setLines((prev) => prev.map((l) => (l.sku._id === skuId ? { ...l, [field]: value } : l)));
  const removeLine = (skuId) => setLines((prev) => prev.filter((l) => l.sku._id !== skuId));

  const changeFrom = async (fromGudang) => {
    setForm((f) => ({ ...f, fromGudang, toGudang: f.toGudang === fromGudang ? '' : f.toGudang }));
    if (!fromGudang || !lines.length) return;
    try {
      const balances = await getTransferSkuBalances(user.token, fromGudang, lines.map((l) => l.sku._id));
      setLines((prev) => prev.map((l) => ({ ...l, currentQty: balances[l.sku._id] ?? 0 })));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load stock balance');
    }
  };

  const summary = useMemo(() => {
    let qty = 0;
    let received = 0;
    let over = 0;
    let empty = 0;
    let value = 0;
    let short = 0;
    for (const l of lines) {
      if (isBlank(l.qty)) empty++;
      const q = Number(l.qty) || 0;
      qty = round2(qty + q);
      if (isDraft && l.currentQty !== null && q > l.currentQty) over++;
      const cost = l.unitCost;
      if (cost !== null && cost !== undefined) value = round2(value + q * cost);
      const r = receiving ? Number(l.receiveInput) : l.qtyReceived;
      if (r !== null && r !== undefined && !Number.isNaN(r)) {
        received = round2(received + r);
        if (r < q) short++;
      }
    }
    return { qty, received, over, empty, value, short };
  }, [lines, isDraft, receiving]);

  // ---------- aksi ----------
  const validate = () => {
    if (!form.fromGudang) return 'Pilih gudang asal.';
    if (!form.toGudang) return 'Pilih gudang tujuan.';
    if (!lines.length) return 'Tambahkan minimal 1 SKU.';
    if (summary.empty) return `${summary.empty} baris belum diisi jumlahnya.`;
    if (lines.some((l) => Number(l.qty) <= 0)) return 'Jumlah kirim harus lebih dari 0.';
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
      const res = isNew ? await createStockTransfer(payload, user.token) : await updateStockTransfer(id, payload, user.token);
      if (!quiet) toast.success(res.data.message);
      const saved = res.data.data;
      if (isNew && !stay) navigate(`/stock-transfer/${saved._id}`, { replace: true });
      else if (!stay) await load();
      return saved._id;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save transfer');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    const error = dirty || isNew ? validate() : null;
    if (error) return toast.warning(error);
    const ok = await confirm({
      title: `Send ${doc?.no || 'transfer'}?`,
      message: `Stok ${lines.length} SKU keluar dari ${gudangCode(form.fromGudang)} sekarang dan berstatus "In transit" sampai diterima di ${gudangCode(form.toGudang)}. Transfer yang sudah dikirim tidak bisa diedit, hanya dibatalkan.`,
      confirmLabel: dirty || isNew ? 'Save & Send' : 'Send',
    });
    if (!ok) return;
    let docId = isNew ? null : id;
    if (dirty || isNew) {
      docId = await save({ quiet: true, stay: true });
      if (!docId) return;
    }
    setBusy(true);
    try {
      const res = await sendStockTransfer(docId, user.token);
      toast.success(res.data.message);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to send transfer');
    } finally {
      setBusy(false);
      if (isNew) navigate(`/stock-transfer/${docId}`, { replace: true });
      else await load();
    }
  };

  const receive = async () => {
    const bad = lines.find((l) => isBlank(l.receiveInput) || Number(l.receiveInput) < 0 || Number(l.receiveInput) > Number(l.qty));
    if (bad) return toast.warning(`${bad.sku.sku}: jumlah diterima harus 0 – ${formatNumber(bad.qty)}.`);
    if (summary.short && !receiveNote.trim()) return toast.warning('Ada barang yang kurang: jelaskan selisihnya di catatan penerimaan.');
    const ok = await confirm({
      title: `Receive ${doc.no}?`,
      message: `${formatNumber(summary.received)} dari ${formatNumber(summary.qty)} masuk ke stok ${doc.toGudang?.code}.`
        + (summary.short ? ` ${summary.short} SKU kurang: selisihnya dicatat hilang/rusak di perjalanan.` : ''),
      confirmLabel: 'Receive',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await receiveStockTransfer(id, {
        lines: lines.map((l) => ({ sku: l.sku._id, qtyReceived: l.receiveInput })),
        note: receiveNote.trim(),
      }, user.token);
      toast.success(res.data.message);
      setReceiveNote('');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to receive transfer');
    } finally {
      setBusy(false);
    }
  };

  const removeDraft = async () => {
    const ok = await confirm({ title: `Delete ${doc.no}?`, message: 'Draft ini akan dihapus permanen. Stok tidak terpengaruh.', confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
    try {
      const res = await deleteStockTransfer(id, user.token);
      toast.success(res.data.message);
      navigate('/stock-transfer');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete transfer');
    }
  };

  const cancelDoc = async (reason) => {
    setBusy(true);
    try {
      const res = await cancelStockTransfer(id, reason, user.token);
      toast.success(res.data.message);
      setCancelOpen(false);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to cancel transfer');
    } finally {
      setBusy(false);
    }
  };

  // ---------- render ----------
  if (notFound) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <p className="text-xl font-semibold text-fg mb-1">Transfer not available</p>
        <p className="text-muted mb-6">{notFound}</p>
        <Link to="/stock-transfer" className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded">
          <i className="fa fa-arrow-left"></i> Back to Stock Transfer
        </Link>
      </div>
    );
  }
  if (!form) return <div className="p-6 text-muted">Loading...</div>;
  if (isNew && perm.loaded && !perm.canCreate) {
    return <div className="p-6 text-muted">You don&apos;t have permission to create stock transfers.</div>;
  }

  const showReceived = status === 'RECEIVED' || receiving;
  const colSpan = 6 + (showReceived ? 1 : 0) + (canSeeCost ? 1 : 0);

  return (
    <div className="h-full p-4 flex flex-col overflow-auto">
      <PageHeader
        fallbackTitle="Stock Transfer"
        parentPath="/stock-transfer"
        title={doc?.no || 'New Transfer'}
        subtitle="Kirim stok dari satu gudang ke gudang lain; stok masuk setelah diterima di gudang tujuan."
        actions={(
          <>
            {!isNew && <StatusBadge status={status} meta={TRANSFER_STATUS_META} />}
            {isDraft && !isNew && perm.canDelete && canSend && (
              <button type="button" onClick={removeDraft} disabled={busy} className={btnDanger}>
                <i className="fa fa-trash"></i> Delete
              </button>
            )}
            {editable && (
              <button type="button" onClick={() => save()} disabled={busy || (!isNew && !dirty)} className={btnGhost}>
                <i className="fa fa-save"></i> Save draft
              </button>
            )}
            {isDraft && perm.canPost && canSend && (isNew ? perm.canCreate : true) && (
              <button type="button" onClick={send} disabled={busy || !lines.length || (dirty && !editable)} className={btnPrimary}>
                <i className="fa fa-truck-fast"></i> {dirty || isNew ? 'Save & Send' : 'Send'}
              </button>
            )}
            {status === 'IN_TRANSIT' && perm.canPost && doc?.canSend && (
              <button type="button" onClick={() => setCancelOpen((o) => !o)} disabled={busy} className={btnDanger}>
                <i className="fa fa-ban"></i> Cancel transfer
              </button>
            )}
            {receiving && (
              <button type="button" onClick={receive} disabled={busy} className={btnPrimary}>
                <i className="fa fa-box-open"></i> Receive
              </button>
            )}
          </>
        )}
      />

      {cancelOpen && (
        <ReasonPanel
          title={`Cancel ${doc.no}`}
          description={`Stok dikembalikan ke ${doc.fromGudang?.code} dengan pergerakan pembalik. Hanya bisa selama belum diterima.`}
          placeholder="Alasan pembatalan (wajib)"
          confirmLabel="Cancel transfer"
          busy={busy}
          onConfirm={cancelDoc}
          onClose={() => setCancelOpen(false)}
        />
      )}

      {status === 'IN_TRANSIT' && !receiving && (
        <p className="mb-4 text-sm px-3 py-2 rounded bg-primary-soft text-primary-soft-fg max-w-3xl">
          <i className="fa fa-truck-fast mr-1.5"></i>
          Dalam perjalanan ke {doc.toGudang?.code}. Penerimaan dilakukan oleh user yang ditugaskan di gudang tujuan.
        </p>
      )}
      {isDraft && !isNew && !editable && (
        <p className="mb-4 text-sm px-3 py-2 rounded bg-subtle text-muted max-w-3xl">
          <i className="fa fa-lock mr-1.5"></i>
          {canSend ? 'Draft ini hanya bisa dilihat (tidak ada izin mengubah).' : `Draft ini dikelola oleh gudang ${doc.fromGudang?.code}.`}
        </p>
      )}

      <div className={`grid gap-4 items-start ${doc ? 'xl:grid-cols-[minmax(0,1fr)_320px]' : ''}`}>
        <div className="space-y-4 min-w-0">
          <section className="rounded-lg border border-line bg-surface p-4">
            <fieldset disabled={!editable || busy} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <FormField label="From warehouse" htmlFor="trf-from" required>
                <select id="trf-from" value={form.fromGudang} onChange={(e) => changeFrom(e.target.value)} className={inputClass}>
                  <option value="">— choose —</option>
                  {(editable ? fromOptions : gudangList.filter((g) => g._id === form.fromGudang)).map((g) => (
                    <option key={g._id} value={g._id}>{g.code} — {g.name}{g.isActive === false ? ' (inactive)' : ''}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="To warehouse" htmlFor="trf-to" required>
                <select id="trf-to" value={form.toGudang} onChange={(e) => setForm((f) => ({ ...f, toGudang: e.target.value }))} className={inputClass}>
                  <option value="">— choose —</option>
                  {toOptions.map((g) => (
                    <option key={g._id} value={g._id}>{g.code} — {g.name}{g.isActive === false ? ' (inactive)' : ''}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Date" htmlFor="trf-date" required>
                <input id="trf-date" type="date" max={toDateInput()} value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className={inputClass} />
              </FormField>
              <FormField label="Note" htmlFor="trf-note">
                <input id="trf-note" value={form.note} placeholder="Optional, mis. no. surat jalan"
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className={inputClass} />
              </FormField>
            </fieldset>
          </section>

          <section className="rounded-lg border border-line bg-surface">
            <div className="px-4 py-3 border-b border-line">
              <h3 className="font-semibold text-fg">SKU ({lines.length})</h3>
              <p className="text-xs text-muted">
                {receiving
                  ? 'Isi jumlah yang benar-benar diterima (default = jumlah dikirim). Kurang dari dikirim = hilang/rusak di perjalanan.'
                  : 'Jumlah dalam satuan dasar, maks. 2 desimal. Stok berkurang di gudang asal saat Send.'}
              </p>
            </div>

            {editable && (
              <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-line-soft bg-subtle">
                {form.fromGudang
                  ? <SkuPicker token={user.token} gudang={form.fromGudang} existing={existing} onAdd={addLines} searchFn={searchTransferSkus} />
                  : <span className="text-sm text-muted">Pilih gudang asal dulu untuk menambah SKU.</span>}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: 820 }}>
                <thead className="bg-head text-head-fg text-left">
                  <tr>
                    <th className="px-3 py-2 border-b border-line font-semibold w-10 text-right">#</th>
                    <th className="px-3 py-2 border-b border-line font-semibold">SKU</th>
                    {isDraft && <th className="px-3 py-2 border-b border-line font-semibold w-32 text-right" title="Saldo saat ini di gudang asal">Available</th>}
                    <th className="px-3 py-2 border-b border-line font-semibold w-32 text-right">Sent</th>
                    {showReceived && <th className="px-3 py-2 border-b border-line font-semibold w-32 text-right">Received</th>}
                    {canSeeCost && (
                      <th className="px-3 py-2 border-b border-line font-semibold w-36 text-right" title={isDraft ? 'Perkiraan: qty x HPP saat ini' : 'Qty x HPP saat dikirim'}>
                        Value{isDraft ? ' (est.)' : ''}
                      </th>
                    )}
                    <th className="px-3 py-2 border-b border-line font-semibold w-56">Line note</th>
                    {editable && <th className="px-3 py-2 border-b border-line w-12"></th>}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, index) => {
                    const over = isDraft && l.currentQty !== null && Number(l.qty) > l.currentQty;
                    const rcv = receiving ? Number(l.receiveInput) : l.qtyReceived;
                    const short = rcv !== null && rcv !== undefined && !Number.isNaN(rcv) && rcv < Number(l.qty);
                    const value = l.unitCost === null || l.unitCost === undefined || isBlank(l.qty) ? null : round2(Number(l.qty) * l.unitCost);
                    return (
                      <tr key={l.sku._id || index} className={over ? 'bg-danger-soft' : 'hover:bg-subtle'}>
                        <td className="px-3 py-1.5 border-t border-line-soft text-right text-muted tabular-nums">{index + 1}</td>
                        <td className="px-3 py-1.5 border-t border-line-soft">
                          <div className="font-mono text-xs font-semibold text-fg">
                            {l.sku.sku}
                            {!l.sku.isActive && <span className="ml-1.5 font-sans text-[10px] px-1 rounded bg-subtle text-muted">inactive</span>}
                          </div>
                          <div className="text-xs text-muted truncate max-w-72">{l.sku.produkName} · {l.sku.variant}</div>
                        </td>
                        {isDraft && (
                          <td className={`px-3 py-1.5 border-t border-line-soft text-right tabular-nums ${over ? 'text-danger font-semibold' : 'text-muted'}`}>
                            {l.currentQty === null ? '-' : `${formatNumber(l.currentQty)} ${l.sku.uom}`}
                          </td>
                        )}
                        <td className="px-3 py-1.5 border-t border-line-soft text-right tabular-nums">
                          {editable ? (
                            <input aria-label={`Quantity ${l.sku.sku}`} type="number" min="0" step="0.01" value={l.qty} disabled={busy}
                              onChange={(e) => setLine(l.sku._id, 'qty', e.target.value)} className={`${cellInput} text-right tabular-nums`} />
                          ) : formatNumber(l.qty)}
                        </td>
                        {showReceived && (
                          <td className="px-3 py-1.5 border-t border-line-soft text-right tabular-nums">
                            {receiving ? (
                              <input aria-label={`Received ${l.sku.sku}`} type="number" min="0" max={l.qty} step="0.01" value={l.receiveInput} disabled={busy}
                                onChange={(e) => setLine(l.sku._id, 'receiveInput', e.target.value)}
                                className={`${cellInput} text-right tabular-nums ${short ? 'border-danger' : ''}`} />
                            ) : (
                              <span className={short ? 'text-danger font-semibold' : ''} title={short ? `Kurang ${formatNumber(round2(l.qty - l.qtyReceived))}` : undefined}>
                                {formatNumber(l.qtyReceived)}
                              </span>
                            )}
                          </td>
                        )}
                        {canSeeCost && (
                          <td className="px-3 py-1.5 border-t border-line-soft text-right tabular-nums"
                            title={l.unitCost !== null && l.unitCost !== undefined ? `HPP ${formatRupiah(l.unitCost)}` : 'HPP belum ada'}>
                            {value === null ? <span className="text-muted">-</span> : formatRupiah(value)}
                            {l.lossValue > 0 && <div className="text-[10px] text-danger">loss {formatRupiah(l.lossValue)}</div>}
                          </td>
                        )}
                        <td className="px-3 py-1.5 border-t border-line-soft">
                          <input aria-label={`Note ${l.sku.sku}`} value={l.note} maxLength={200} disabled={!editable || busy}
                            onChange={(e) => setLine(l.sku._id, 'note', e.target.value)} className={cellInput} />
                        </td>
                        {editable && (
                          <td className="px-3 py-1.5 border-t border-line-soft text-center">
                            <button type="button" title="Remove line" aria-label={`Remove ${l.sku.sku}`} onClick={() => removeLine(l.sku._id)}
                              className="w-8 h-8 rounded-md text-muted hover:text-danger hover:bg-danger-soft cursor-pointer">
                              <i className="fa fa-xmark"></i>
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {lines.length === 0 && (
                    <tr><td colSpan={colSpan} className="text-center py-8 text-muted">Belum ada SKU.{editable && ' Cari SKU di atas.'}</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {lines.length > 0 && (
              <div className="flex flex-wrap gap-x-6 gap-y-1 px-4 py-3 border-t border-line text-sm">
                <span>Total sent: <b className="tabular-nums">{formatNumber(summary.qty)}</b></span>
                {showReceived && <span>Total received: <b className={`tabular-nums ${summary.short ? 'text-danger' : ''}`}>{formatNumber(summary.received)}</b></span>}
                {canSeeCost && <span>Value{isDraft ? ' (est.)' : ''}: <b className="tabular-nums">{formatRupiah(summary.value)}</b></span>}
                {canSeeCost && doc?.totalLoss > 0 && <span className="text-danger">Loss in transit: <b className="tabular-nums">{formatRupiah(doc.totalLoss)}</b></span>}
                {summary.over > 0 && (
                  <span className="text-danger"><i className="fa fa-triangle-exclamation mr-1"></i>{summary.over} SKU melebihi stok gudang asal: Send akan ditolak</span>
                )}
              </div>
            )}

            {receiving && (
              <div className="px-4 py-3 border-t border-line space-y-1">
                <label htmlFor="trf-receive-note" className="text-sm font-medium text-fg">
                  Receive note{summary.short > 0 && <span className="text-danger"> *</span>}
                </label>
                <input id="trf-receive-note" value={receiveNote} disabled={busy} maxLength={500}
                  placeholder={summary.short ? 'Wajib: jelaskan selisih (hilang / rusak di perjalanan)' : 'Optional'}
                  onChange={(e) => setReceiveNote(e.target.value)}
                  className={`${inputClass} ${summary.short && !receiveNote.trim() ? 'border-danger' : ''}`} />
              </div>
            )}
          </section>
        </div>

        {doc && (
        <aside className="space-y-4 min-w-0">
          {doc && (
            <section className="rounded-lg border border-line bg-surface p-4 text-sm space-y-2">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                <dt className="text-muted">Status</dt><dd><StatusBadge status={doc.status} meta={TRANSFER_STATUS_META} /></dd>
                <dt className="text-muted">Route</dt><dd>{doc.fromGudang?.code} <i className="fa fa-arrow-right text-xs text-muted mx-1"></i> {doc.toGudang?.code}</dd>
                {doc.sentDate && (<><dt className="text-muted">Sent</dt><dd>{formatDate2(doc.sentDate)} · {doc.sentBy?.name || '-'}</dd></>)}
                {doc.receivedDate && (<><dt className="text-muted">Received</dt><dd>{formatDate2(doc.receivedDate)} · {doc.receivedBy?.name || '-'}</dd></>)}
                {doc.receiveNote && (<><dt className="text-muted">Receive note</dt><dd className="break-words">{doc.receiveNote}</dd></>)}
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
              <AuditTimeline entity="stockTransfer" id={doc._id} refreshKey={version} />
            </section>
          )}
        </aside>
        )}
      </div>
    </div>
  );
}
