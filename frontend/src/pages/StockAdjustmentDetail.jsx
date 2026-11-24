import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  getStockAdjustment,
  createStockAdjustment,
  updateStockAdjustment,
  deleteStockAdjustment,
  postStockAdjustment,
  cancelStockAdjustment,
  searchStockSkus,
  getSkuBalances,
} from '../services/stockService';
import { getMyGudangDropdown } from '../services/gudangService';
import { getProdukDropdown } from '../services/produkService';
import { getKategoriDropdown } from '../services/kategoriService';
import { useAuth } from '../context/AuthContext';
import usePermission from '../hooks/usePermission';
import useToast from '../hooks/useToast';
import useConfirm from '../hooks/useConfirm';
import PageHeader from '../components/PageHeader';
import FormField from '../components/FormField';
import SkuPicker from '../components/stock/SkuPicker';
import StatusBadge from '../components/stock/StatusBadge';
import AuditTimeline from '../components/audit/AuditTimeline';
import { AuditDetail } from '../components/AuditInfo';
import { inputClass } from '../utils/formStyles';
import { formatNumber, formatRupiah, formatSigned, round2, variantLabel } from '../utils/formatHelper';
import { formatDate2, toDateInput } from '../utils/dateHelper';
import { ADJUSTMENT_TYPES, ADJUSTMENT_REASONS, REASONS } from '../utils/stockMeta';

const cellInput = `w-full bg-input text-fg border border-line rounded px-2 py-1 text-sm
  focus:outline-none focus:border-primary disabled:bg-transparent disabled:border-transparent`;
const btn = 'px-4 py-2 rounded text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
const btnGhost = `${btn} border border-line hover:bg-subtle`;
const btnPrimary = `${btn} bg-primary hover:bg-primary-hover text-primary-fg`;
const btnDanger = `${btn} border border-danger-line text-danger hover:bg-danger-soft`;

const LINE_FILTER_FROM = 15; // tampilkan filter baris jika baris sebanyak ini

// baris dari dokumen yang dimuat (sku & produk sudah di-populate)
const lineFromDoc = (l) => ({
  sku: {
    _id: l.sku?._id ?? null,
    sku: l.sku?.sku ?? '(deleted SKU)',
    produkName: l.produk?.name || '',
    variant: variantLabel(l.sku),
    uom: l.produk?.uom?.code || '',
    isActive: l.sku?.isActive !== false,
  },
  qtyChange: l.qtyChange ?? '',
  qtyActual: l.qtyActual ?? '',
  note: l.note || '',
  currentQty: l.currentQty ?? null,
  qtySystem: l.qtySystem ?? null,
  unitCost: l.unitCost ?? null,   // hanya jika boleh melihat biaya (draft: input ?? HPP; posted: dari movement)
  avgCost: l.avgCost ?? null,     // draft: HPP SKU saat ini
  inputCost: l.inputCost ?? '',   // Saldo Awal: harga pokok yang diisi
  value: l.value ?? null,         // posted: nilai saat post
});

// baris dari hasil pencarian SKU
const lineFromSearch = (s) => ({
  sku: { _id: s._id, sku: s.sku, produkName: s.produk?.name || '', variant: s.variant, uom: s.uom, isActive: s.isActive },
  qtyChange: '',
  qtyActual: '',
  note: '',
  currentQty: s.qty,
  qtySystem: null,
  unitCost: s.avgCost ?? null,
  avgCost: s.avgCost ?? null,
  inputCost: '',
  value: null,
});

// harga pokok hanya dikirim untuk Saldo Awal oleh user yang boleh melihat biaya
const toPayload = (form, lines, sendCost = false) => ({
  type: form.type,
  gudang: form.gudang,
  date: form.date,
  reason: form.type === 'OPNAME' ? 'OPNAME' : form.reason,
  note: form.note,
  lines: lines.map((l) => ({
    sku: l.sku._id,
    note: l.note,
    ...(form.type === 'OPNAME' ? { qtyActual: l.qtyActual } : { qtyChange: l.qtyChange }),
    ...(sendCost && form.reason === 'OPENING' ? { unitCost: l.inputCost === '' ? null : l.inputCost } : {}),
  })),
});

const isBlank = (v) => v === '' || v === null || v === undefined;

/** Muat semua SKU dari 1 produk / kategori (untuk Stock Opname) */
function BulkLoader({ token, gudang, onLoad }) {
  const [mode, setMode] = useState('produk');
  const [options, setOptions] = useState({ produk: [], kategori: [] });
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([getProdukDropdown(token), getKategoriDropdown(token)])
      .then(([produk, kategori]) => setOptions({ produk, kategori }))
      .catch(console.error);
  }, [token]);

  const load = async () => {
    if (!value) return;
    setLoading(true);
    try {
      onLoad(await searchStockSkus(token, { gudang, [mode]: value }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Load by" value={mode} onChange={(e) => { setMode(e.target.value); setValue(''); }} className={`${inputClass} w-auto`}>
        <option value="produk">Product</option>
        <option value="kategori">Category</option>
      </select>
      <select aria-label={`Choose ${mode}`} value={value} onChange={(e) => setValue(e.target.value)} className={`${inputClass} w-auto max-w-56`}>
        <option value="">— choose {mode === 'produk' ? 'product' : 'category'} —</option>
        {options[mode].map((o) => <option key={o._id} value={o._id}>{o.name}</option>)}
      </select>
      <button type="button" onClick={load} disabled={!value || loading} className={btnGhost}>
        <i className="fa fa-download"></i> {loading ? 'Loading...' : 'Load all SKU'}
      </button>
    </div>
  );
}

/**
 * Dokumen Stock Adjustment / Stock Opname: /stock-adjustment/:id  (id = 'new' -> ?type=ADJUSTMENT|OPNAME)
 *   Draft   : isi header & baris, Save draft (izin create/update), Delete (izin delete)
 *   Post    : terapkan ke stok (izin post). Opname: selisih = jumlah fisik − stok sistem saat Post.
 *   Cancel  : dokumen Posted dibatalkan dengan movement pembalik (izin post), wajib alasan.
 */
export default function StockAdjustmentDetail() {
  const { id } = useParams();
  const isNew = id === 'new';
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const perm = usePermission('stockAdjustment');
  const movementPerm = usePermission('stockMovement');
  // nilai rupiah (HPP) = data biaya
  const canSeeCost = usePermission('vendorPrice').canView;
  const toast = useToast();
  const confirm = useConfirm();

  const [doc, setDoc] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [form, setForm] = useState(null);
  const [lines, setLines] = useState([]);
  const [savedPayload, setSavedPayload] = useState(null);
  const [gudangList, setGudangList] = useState([]);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [lineFilter, setLineFilter] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  useEffect(() => {
    getMyGudangDropdown(user.token).then(setGudangList).catch(console.error);
  }, [user.token]);

  // dipakai applyDoc (callback stabil) untuk membandingkan payload dengan format yang sama
  const canSeeCostRef = useRef(canSeeCost);
  canSeeCostRef.current = canSeeCost;

  const applyDoc = useCallback((d) => {
    const f = {
      type: d.type,
      gudang: d.gudang?._id || '',
      date: toDateInput(d.date),
      reason: d.reason,
      note: d.note || '',
    };
    const ls = d.lines.map(lineFromDoc);
    setDoc(d);
    setForm(f);
    setLines(ls);
    setSavedPayload(JSON.stringify(toPayload(f, ls, canSeeCostRef.current)));
  }, []);

  const load = useCallback(async () => {
    try {
      applyDoc(await getStockAdjustment(id, user.token));
      setVersion((v) => v + 1);
    } catch (err) {
      if ([400, 404].includes(err.response?.status)) setNotFound(true);
      else console.error(err);
    }
  }, [id, user.token, applyDoc]);

  // dokumen baru: jenis dari ?type=, gudang default = satu-satunya gudang aktif / MAIN
  useEffect(() => {
    if (!isNew) {
      load();
      return;
    }
    const type = ADJUSTMENT_TYPES[searchParams.get('type')] ? searchParams.get('type') : 'ADJUSTMENT';
    setDoc(null);
    setLines([]);
    setSavedPayload(null);
    setForm({ type, gudang: '', date: toDateInput(), reason: type === 'OPNAME' ? 'OPNAME' : '', note: '' });
  }, [isNew, load, searchParams]);

  const activeGudang = gudangList.filter((g) => g.isActive !== false);
  useEffect(() => {
    if (!isNew || !form || form.gudang || !activeGudang.length) return;
    const def = activeGudang.length === 1 ? activeGudang[0] : activeGudang.find((g) => g.code === 'MAIN');
    if (def) setForm((f) => ({ ...f, gudang: def._id }));
  }, [isNew, form, activeGudang]);

  const status = isNew ? 'DRAFT' : doc?.status;
  const isOpname = form?.type === 'OPNAME';
  const isDraft = status === 'DRAFT';
  const isOpening = !isOpname && form?.reason === 'OPENING';
  const showCostInput = isOpening && canSeeCost;
  // harga per satuan untuk nilai baris: harga pokok yang diisi (Saldo Awal) atau HPP saat ini
  const costFor = (l) => {
    if (isOpening && !isBlank(l.inputCost)) return Number(l.inputCost);
    return l.avgCost ?? l.unitCost ?? null;
  };
  const editable = isNew ? perm.canCreate : isDraft && perm.canUpdate;
  const payload = form ? toPayload(form, lines, canSeeCost) : null;
  const dirty = editable && (isNew ? lines.length > 0 : JSON.stringify(payload) !== savedPayload);

  // ---------- baris ----------
  const existing = useMemo(() => new Set(lines.map((l) => l.sku._id)), [lines]);

  const addLines = (skus) => {
    const fresh = skus.filter((s) => !existing.has(s._id));
    if (!fresh.length) {
      toast.info('Semua SKU tersebut sudah ada di dokumen.');
      return;
    }
    setLines((prev) => [...prev, ...fresh.map(lineFromSearch)]);
    if (skus.length > 1) toast.success(`${fresh.length} SKU ditambahkan${skus.length > fresh.length ? ` (${skus.length - fresh.length} sudah ada)` : ''}.`);
  };

  const setLine = (skuId, field, value) => {
    setLines((prev) => prev.map((l) => (l.sku._id === skuId ? { ...l, [field]: value } : l)));
  };
  const removeLine = (skuId) => setLines((prev) => prev.filter((l) => l.sku._id !== skuId));

  // gudang diganti -> saldo sistem per baris ikut gudang baru
  const changeGudang = async (gudang) => {
    setForm((f) => ({ ...f, gudang }));
    if (!gudang || !lines.length) return;
    try {
      const balances = await getSkuBalances(user.token, gudang, lines.map((l) => l.sku._id));
      setLines((prev) => prev.map((l) => ({ ...l, currentQty: balances[l.sku._id] ?? 0 })));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load stock balance');
    }
  };

  // nilai tampilan per baris
  const view = (l) => {
    const system = isDraft ? l.currentQty : l.qtySystem;
    let change;
    if (!isDraft) change = l.qtyChange === '' ? null : Number(l.qtyChange);
    else if (isOpname) change = isBlank(l.qtyActual) || system === null ? null : round2(Number(l.qtyActual) - system);
    else change = isBlank(l.qtyChange) ? null : Number(l.qtyChange);
    const after = system === null || change === null ? null : round2(system + change);
    let value = null;
    const cost = costFor(l);
    if (!isDraft) value = l.value;
    else if (change !== null && cost !== null && cost !== undefined) value = round2(change * cost);
    return { system, change, after, value };
  };

  const summary = useMemo(() => {
    let plus = 0;
    let minus = 0;
    let negative = 0;
    let empty = 0;
    let value = 0;
    for (const l of lines) {
      const { change, after, value: v } = view(l);
      value = round2(value + (v || 0));
      if (change === null) empty++;
      else if (change > 0) plus = round2(plus + change);
      else minus = round2(minus + change);
      if (after !== null && after < 0) negative++;
    }
    return { plus, minus, negative, empty, value };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, isDraft, isOpname]);

  const shownLines = useMemo(() => {
    const q = lineFilter.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter((l) => `${l.sku.sku} ${l.sku.produkName} ${l.sku.variant}`.toLowerCase().includes(q));
  }, [lines, lineFilter]);

  // Enter di kolom qty -> pindah ke baris berikutnya (input cepat saat opname)
  const onQtyKeyDown = (e, index) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    document.querySelector(`[data-qty-index="${index + 1}"]`)?.focus();
  };

  // ---------- aksi ----------
  const validate = () => {
    if (!form.gudang) return 'Pilih gudang.';
    if (!isOpname && !form.reason) return 'Pilih alasan penyesuaian.';
    if (form.reason === 'OTHER' && !form.note.trim()) return 'Catatan wajib diisi untuk alasan "Other".';
    if (!lines.length) return 'Tambahkan minimal 1 SKU.';
    if (summary.empty) return `${summary.empty} baris belum diisi jumlahnya.`;
    if (isOpening && canSeeCost) {
      const need = lines.filter((l) => Number(l.qtyChange) > 0 && (l.avgCost === null || l.avgCost === undefined) && isBlank(l.inputCost));
      if (need.length) return `Isi harga pokok untuk SKU yang belum punya HPP: ${need.map((l) => l.sku.sku).join(', ')}`;
    }
    return null;
  };

  /** Simpan draft. Return id dokumen (atau null jika gagal). `stay` = jangan pindah halaman (lanjut Post). */
  const save = async ({ quiet = false, stay = false } = {}) => {
    const error = validate();
    if (error) {
      toast.warning(error);
      return null;
    }
    setBusy(true);
    try {
      const res = isNew
        ? await createStockAdjustment(payload, user.token)
        : await updateStockAdjustment(id, payload, user.token);
      if (!quiet) toast.success(res.data.message);
      const saved = res.data.data;
      if (isNew) {
        if (!stay) navigate(`/stock-adjustment/${saved._id}`, { replace: true });
      } else if (!stay) {
        await load();
      }
      return saved._id;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save document');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const post = async () => {
    const error = dirty ? validate() : (summary.empty ? `${summary.empty} baris belum diisi jumlahnya.` : null);
    if (error) return toast.warning(error);
    const ok = await confirm({
      title: `Post ${doc?.no || 'document'}?`,
      message: `Stok ${lines.length} SKU di gudang ${gudangList.find((g) => g._id === form.gudang)?.code || ''} akan diubah sekarang`
        + `${isOpname ? ' (selisih dihitung dari stok sistem saat ini)' : ''}. `
        + 'Dokumen yang sudah diposting tidak bisa diedit, hanya dibatalkan.',
      confirmLabel: dirty ? 'Save & Post' : 'Post',
    });
    if (!ok) return;

    let docId = isNew ? null : id;
    if (dirty || isNew) {
      docId = await save({ quiet: true, stay: true });
      if (!docId) return;
    }
    setBusy(true);
    try {
      const res = await postStockAdjustment(docId, user.token);
      toast.success(res.data.message);
    } catch (err) {
      // draft tetap tersimpan; tampilkan kondisi terbaru
      toast.error(err.response?.data?.message || 'Failed to post document');
    } finally {
      setBusy(false);
      if (isNew) navigate(`/stock-adjustment/${docId}`, { replace: true });
      else await load();
    }
  };

  const removeDraft = async () => {
    const ok = await confirm({
      title: `Delete ${doc.no}?`,
      message: 'Draft ini akan dihapus permanen. Stok tidak terpengaruh.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const res = await deleteStockAdjustment(id, user.token);
      toast.success(res.data.message);
      navigate('/stock-adjustment');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete document');
    }
  };

  const cancelDoc = async () => {
    if (!cancelReason.trim()) return toast.warning('Isi alasan pembatalan.');
    setBusy(true);
    try {
      const res = await cancelStockAdjustment(id, cancelReason.trim(), user.token);
      toast.success(res.data.message);
      setCancelOpen(false);
      setCancelReason('');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to cancel document');
    } finally {
      setBusy(false);
    }
  };

  // ---------- render ----------
  if (notFound) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <p className="text-xl font-semibold text-fg mb-1">Document not found</p>
        <p className="text-muted mb-6">Draft mungkin sudah dihapus.</p>
        <Link to="/stock-adjustment" className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded">
          <i className="fa fa-arrow-left"></i> Back to Stock Adjustment
        </Link>
      </div>
    );
  }

  if (!form) return <div className="p-6 text-muted">Loading...</div>;

  if (isNew && perm.loaded && !perm.canCreate) {
    return <div className="p-6 text-muted">You don&apos;t have permission to create stock adjustments.</div>;
  }

  const typeMeta = ADJUSTMENT_TYPES[form.type];
  const gudangOptions = gudangList.filter((g) => g.isActive !== false || g._id === form.gudang);
  const uomHint = lines[0]?.sku.uom;

  return (
    <div className="h-full p-4 flex flex-col overflow-auto">
      <PageHeader
        fallbackTitle="Stock Adjustment"
        parentPath="/stock-adjustment"
        title={doc?.no || `New ${typeMeta.label}`}
        subtitle={typeMeta.hint}
        actions={(
          <>
            {!isNew && <StatusBadge status={status} />}
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
            {isDraft && perm.canPost && (isNew ? perm.canCreate : true) && (
              <button type="button" onClick={post} disabled={busy || !lines.length || (dirty && !editable)} className={btnPrimary}>
                <i className="fa fa-check-double"></i> {dirty || isNew ? 'Save & Post' : 'Post'}
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
        <section className="mb-4 rounded-lg border border-danger-line bg-danger-soft p-4 space-y-3 max-w-3xl">
          <div>
            <h3 className="font-semibold text-danger">Cancel {doc.no}</h3>
            <p className="text-sm text-fg">
              Stok dikembalikan dengan pergerakan pembalik (dokumen & kartu stok tidak dihapus).
              Ditolak jika stok saat ini tidak cukup untuk dibalik.
            </p>
          </div>
          <textarea
            aria-label="Cancellation reason"
            rows={2}
            placeholder="Alasan pembatalan (wajib)"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            className={`${cellInput} bg-surface`}
            autoFocus
          />
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setCancelOpen(false)} className={btnGhost}>Close</button>
            <button type="button" onClick={cancelDoc} disabled={busy || !cancelReason.trim()} className={`${btn} bg-danger text-danger-fg hover:opacity-90`}>
              <i className="fa fa-ban"></i> Cancel document
            </button>
          </div>
        </section>
      )}

      {isDraft && !editable && !isNew && (
        <p className="mb-4 text-sm px-3 py-2 rounded bg-subtle text-muted max-w-3xl">
          <i className="fa fa-lock mr-1.5"></i>
          Draft ini hanya bisa dilihat{perm.canPost ? ' dan diposting' : ''} (tidak ada izin mengubah).
        </p>
      )}

      <div className={`grid gap-4 items-start ${doc ? 'xl:grid-cols-[minmax(0,1fr)_320px]' : ''}`}>
        <div className="space-y-4 min-w-0">
          {/* Header dokumen */}
          <section className="rounded-lg border border-line bg-surface p-4">
            <fieldset disabled={!editable || busy} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <FormField label="Warehouse" htmlFor="adj-gudang" required>
                <select id="adj-gudang" value={form.gudang} onChange={(e) => changeGudang(e.target.value)} className={inputClass}>
                  <option value="">— choose —</option>
                  {gudangOptions.map((g) => (
                    <option key={g._id} value={g._id}>{g.code} — {g.name}{g.isActive === false ? ' (inactive)' : ''}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Date" htmlFor="adj-date" required>
                <input
                  id="adj-date"
                  type="date"
                  max={toDateInput()}
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  className={inputClass}
                />
              </FormField>
              <FormField label="Reason" htmlFor="adj-reason" required>
                {isOpname ? (
                  <input id="adj-reason" value={REASONS.OPNAME} disabled className={inputClass} />
                ) : (
                  <select id="adj-reason" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} className={inputClass}>
                    <option value="">— choose —</option>
                    {ADJUSTMENT_REASONS.map((k) => <option key={k} value={k}>{REASONS[k]}</option>)}
                  </select>
                )}
              </FormField>
              <FormField label="Note" htmlFor="adj-note" required={form.reason === 'OTHER'}>
                <input
                  id="adj-note"
                  value={form.note}
                  placeholder={form.reason === 'OTHER' ? 'Wajib untuk alasan Other' : 'Optional'}
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                  className={inputClass}
                />
              </FormField>
            </fieldset>
          </section>

          {/* Baris SKU */}
          <section className="rounded-lg border border-line bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-line">
              <div>
                <h3 className="font-semibold text-fg">SKU ({lines.length})</h3>
                <p className="text-xs text-muted">
                  {isOpname
                    ? 'Isi jumlah fisik. Stok sistem & selisih di bawah adalah perkiraan saat ini; nilai final diambil saat Post.'
                    : 'Isi perubahan: angka positif menambah stok, negatif mengurangi.'}
                  {' '}Maks. 2 desimal{uomHint ? `, dalam satuan dasar (mis. ${uomHint})` : ''}.
                </p>
              </div>
              {lines.length >= LINE_FILTER_FROM && (
                <input
                  type="search"
                  aria-label="Filter lines"
                  placeholder="Filter baris..."
                  value={lineFilter}
                  onChange={(e) => setLineFilter(e.target.value)}
                  className={`${inputClass} w-48`}
                />
              )}
            </div>

            {editable && (
              <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-line-soft bg-subtle">
                <SkuPicker token={user.token} gudang={form.gudang} existing={existing} onAdd={addLines} />
                {isOpname && <BulkLoader token={user.token} gudang={form.gudang} onLoad={addLines} />}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: canSeeCost ? 1000 : 860 }}>
                <thead className="bg-head text-head-fg text-left">
                  <tr>
                    <th className="px-3 py-2 border-b border-line font-semibold w-10 text-right">#</th>
                    <th className="px-3 py-2 border-b border-line font-semibold">SKU</th>
                    <th className="px-3 py-2 border-b border-line font-semibold w-28 text-right">
                      {isDraft ? 'Current' : 'System'}
                    </th>
                    {isOpname && <th className="px-3 py-2 border-b border-line font-semibold w-32 text-right">Counted</th>}
                    <th className="px-3 py-2 border-b border-line font-semibold w-32 text-right">{isOpname ? 'Difference' : 'Change'}</th>
                    <th className="px-3 py-2 border-b border-line font-semibold w-28 text-right">After</th>
                    {canSeeCost && (
                      <th className="px-3 py-2 border-b border-line font-semibold w-36 text-right" title={isDraft ? 'Perkiraan: perubahan x HPP saat ini' : 'Nilai saat diposting'}>
                        Value{isDraft ? ' (est.)' : ''}
                      </th>
                    )}
                    {showCostInput && (
                      <th className="px-3 py-2 border-b border-line font-semibold w-36 text-right" title="Harga pokok per satuan dasar untuk stok Saldo Awal; ikut menghitung HPP. Wajib bila SKU belum punya HPP.">
                        Unit cost
                      </th>
                    )}
                    <th className="px-3 py-2 border-b border-line font-semibold w-56">Line note</th>
                    {editable && <th className="px-3 py-2 border-b border-line w-12"></th>}
                  </tr>
                </thead>
                <tbody>
                  {shownLines.map((l, index) => {
                    const { system, change, after, value } = view(l);
                    return (
                      <tr key={l.sku._id || index} className={after !== null && after < 0 ? 'bg-danger-soft' : 'hover:bg-subtle'}>
                        <td className="px-3 py-1.5 border-t border-line-soft text-right text-muted tabular-nums">{index + 1}</td>
                        <td className="px-3 py-1.5 border-t border-line-soft">
                          <div className="font-mono text-xs font-semibold text-fg">
                            {l.sku.sku}
                            {!l.sku.isActive && <span className="ml-1.5 font-sans text-[10px] px-1 rounded bg-subtle text-muted">inactive</span>}
                          </div>
                          <div className="text-xs text-muted truncate max-w-72">{l.sku.produkName} · {l.sku.variant}</div>
                        </td>
                        <td className="px-3 py-1.5 border-t border-line-soft text-right tabular-nums text-muted">
                          {system === null ? '-' : `${formatNumber(system)} ${l.sku.uom}`}
                        </td>
                        {isOpname && (
                          <td className="px-3 py-1.5 border-t border-line-soft">
                            <input
                              aria-label={`Counted ${l.sku.sku}`}
                              type="number"
                              min="0"
                              step="0.01"
                              data-qty-index={index}
                              value={l.qtyActual}
                              disabled={!editable || busy}
                              onChange={(e) => setLine(l.sku._id, 'qtyActual', e.target.value)}
                              onKeyDown={(e) => onQtyKeyDown(e, index)}
                              className={`${cellInput} text-right tabular-nums`}
                            />
                          </td>
                        )}
                        <td className="px-3 py-1.5 border-t border-line-soft text-right tabular-nums">
                          {!isOpname && editable ? (
                            <input
                              aria-label={`Change ${l.sku.sku}`}
                              type="number"
                              step="0.01"
                              data-qty-index={index}
                              placeholder="+/−"
                              value={l.qtyChange}
                              disabled={busy}
                              onChange={(e) => setLine(l.sku._id, 'qtyChange', e.target.value)}
                              onKeyDown={(e) => onQtyKeyDown(e, index)}
                              className={`${cellInput} text-right tabular-nums`}
                            />
                          ) : (
                            <span className={`font-medium ${change > 0 ? 'text-success-fg' : change < 0 ? 'text-danger' : 'text-muted'}`}>
                              {change === null ? '-' : formatSigned(change)}
                            </span>
                          )}
                        </td>
                        <td className={`px-3 py-1.5 border-t border-line-soft text-right tabular-nums ${after !== null && after < 0 ? 'text-danger font-semibold' : ''}`}>
                          {after === null ? '-' : formatNumber(after)}
                        </td>
                        {canSeeCost && (
                          <td className="px-3 py-1.5 border-t border-line-soft text-right tabular-nums"
                            title={l.unitCost !== null && l.unitCost !== undefined ? `HPP ${formatRupiah(l.unitCost)}` : 'HPP belum ada'}>
                            {value === null || value === undefined ? <span className="text-muted">-</span> : (
                              <span className={value < 0 ? 'text-danger' : value > 0 ? 'text-success-fg' : 'text-muted'}>{formatRupiah(value)}</span>
                            )}
                          </td>
                        )}
                        {showCostInput && (
                          <td className="px-3 py-1.5 border-t border-line-soft text-right">
                            {isDraft && editable && Number(l.qtyChange) > 0 ? (
                              <>
                                <input
                                  aria-label={`Unit cost ${l.sku.sku}`}
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={l.inputCost}
                                  disabled={busy}
                                  placeholder={l.avgCost !== null && l.avgCost !== undefined ? String(l.avgCost) : 'wajib'}
                                  onChange={(e) => setLine(l.sku._id, 'inputCost', e.target.value)}
                                  className={`${cellInput} text-right tabular-nums ${l.avgCost === null && isBlank(l.inputCost) ? 'border-danger' : ''}`}
                                />
                                <div className="text-[10px] text-muted mt-0.5">
                                  {l.avgCost !== null && l.avgCost !== undefined ? `kosong = HPP ${formatRupiah(l.avgCost)}` : 'belum ada HPP'}
                                </div>
                              </>
                            ) : (
                              <span className="tabular-nums">{isDraft ? (isBlank(l.inputCost) ? '-' : formatRupiah(l.inputCost)) : (l.unitCost === null ? '-' : formatRupiah(l.unitCost))}</span>
                            )}
                          </td>
                        )}
                        <td className="px-3 py-1.5 border-t border-line-soft">
                          <input
                            aria-label={`Note ${l.sku.sku}`}
                            value={l.note}
                            maxLength={200}
                            disabled={!editable || busy}
                            onChange={(e) => setLine(l.sku._id, 'note', e.target.value)}
                            className={cellInput}
                          />
                        </td>
                        {editable && (
                          <td className="px-3 py-1.5 border-t border-line-soft text-center">
                            <button
                              type="button"
                              title="Remove line"
                              aria-label={`Remove ${l.sku.sku}`}
                              onClick={() => removeLine(l.sku._id)}
                              className="w-8 h-8 rounded-md text-muted hover:text-danger hover:bg-danger-soft cursor-pointer"
                            >
                              <i className="fa fa-xmark"></i>
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {lines.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center py-8 text-muted">
                        Belum ada SKU.{editable && ` Cari SKU di atas${isOpname ? ' atau muat semua SKU dari produk/kategori' : ''}.`}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {lines.length > 0 && (
              <div className="flex flex-wrap gap-x-6 gap-y-1 px-4 py-3 border-t border-line text-sm">
                <span>Total in: <b className="text-success-fg tabular-nums">{formatSigned(summary.plus)}</b></span>
                <span>Total out: <b className="text-danger tabular-nums">{formatSigned(summary.minus)}</b></span>
                {canSeeCost && (
                  <span title={isDraft ? 'Perkiraan dengan HPP saat ini; nilai final dihitung saat Post' : 'Nilai saat diposting'}>
                    Net value{isDraft ? ' (est.)' : ''}: <b className={`tabular-nums ${summary.value < 0 ? 'text-danger' : 'text-success-fg'}`}>{formatRupiah(summary.value)}</b>
                  </span>
                )}
                {summary.empty > 0 && isDraft && <span className="text-warning-fg">{summary.empty} baris belum diisi</span>}
                {summary.negative > 0 && (
                  <span className="text-danger">
                    <i className="fa fa-triangle-exclamation mr-1"></i>
                    {summary.negative} SKU akan minus: Post akan ditolak
                  </span>
                )}
              </div>
            )}
          </section>
        </div>

        {/* Samping: info dokumen & histori */}
        {doc && (
        <aside className="space-y-4 min-w-0">
          {doc && (
            <section className="rounded-lg border border-line bg-surface p-4 text-sm space-y-2">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                <dt className="text-muted">Type</dt><dd>{typeMeta.label}</dd>
                <dt className="text-muted">Status</dt><dd><StatusBadge status={doc.status} /></dd>
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
          )}
          {doc && <AuditDetail data={doc} />}
          {doc && (
            <section className="rounded-lg border border-line bg-surface p-4">
              <h3 className="font-semibold text-fg mb-2">History</h3>
              <AuditTimeline entity="stockAdjustment" id={doc._id} refreshKey={version} />
            </section>
          )}
        </aside>
        )}
      </div>
    </div>
  );
}
