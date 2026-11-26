import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  getSalesInvoice,
  createSalesInvoice,
  updateSalesInvoice,
  deleteSalesInvoice,
  postSalesInvoice,
  cancelSalesInvoice,
  searchSalesSkus,
  getSalesSkuBalances,
  getSalesSkuPrices,
  getCustomerDropdown,
} from '../services/salesService';
import { getGudangDropdown } from '../services/gudangService';
import { getSettings } from '../services/purchaseService';
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
import InvoicePayments from '../components/sales/InvoicePayments';
import { AuditDetail } from '../components/AuditInfo';
import { inputClass } from '../utils/formStyles';
import { formatNumber, formatRupiah, round2, variantLabel } from '../utils/formatHelper';
import { formatDate2, formatDay, toDateInput } from '../utils/dateHelper';
import { INVOICE_STATUS_META, RETURN_STATUS_META, PAYMENT_STATUS_META, salesLineSubtotal, salesTotals } from '../utils/salesMeta';

const cellInput = `w-full bg-input text-fg border border-line rounded px-2 py-1 text-sm
  focus:outline-none focus:border-primary disabled:bg-transparent disabled:border-transparent`;
const btn = 'px-4 py-2 rounded text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
const btnGhost = `${btn} border border-line hover:bg-subtle`;
const btnPrimary = `${btn} bg-primary hover:bg-primary-hover text-primary-fg`;
const btnDanger = `${btn} border border-danger-line text-danger hover:bg-danger-soft`;

const isBlank = (v) => v === '' || v === null || v === undefined;
const hasValue = (v) => v !== null && v !== undefined;

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
  hargaJual: l.hargaJual ?? '',
  diskonPersen: l.diskonPersen || 0,
  note: l.note || '',
  currentQty: l.currentQty ?? null,
  unitCost: l.unitCost ?? null,
  qtyReturned: l.qtyReturned || 0,
});

const lineFromSearch = (s) => ({
  sku: { _id: s._id, sku: s.sku, produkName: s.produk?.name || '', variant: s.variant, uom: s.uom, isActive: s.isActive },
  qty: 1,
  hargaJual: s.hargaJual ?? '',
  diskonPersen: 0,
  note: '',
  currentQty: s.qty,
  unitCost: s.avgCost ?? null,
  priceSource: s.priceSource || 'default',
});

const toPayload = (form, lines) => ({
  customer: form.customer,
  gudang: form.gudang,
  date: form.date,
  dueDate: form.dueDate || null,
  note: form.note,
  taxRate: form.taxRate,
  priceIncludesTax: form.priceIncludesTax,
  discountAmount: form.discountAmount || 0,
  // harga tidak dikirim: backend mengisinya dari price list / harga jual SKU (dibekukan)
  lines: lines.map((l) => ({ sku: l.sku._id, qty: l.qty, diskonPersen: l.diskonPersen || 0, note: l.note })),
});

/**
 * Sales Invoice (penjualan langsung): /sales-invoice/:id (id = 'new')
 *   Draft  : customer (default Walk-in), gudang, baris SKU (harga default = harga jual SKU), diskon baris & dokumen, PPN
 *   Post   : stok keluar dari gudang (izin post); HPP saat itu dicatat -> laba kotor
 *   Cancel : stok kembali dengan HPP yang sama (alasan wajib)
 * HPP, margin & peringatan "di bawah HPP" hanya untuk user yang boleh melihat biaya (vendorPrice:view).
 */
export default function SalesInvoiceDetail() {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const { user } = useAuth();
  const perm = usePermission('salesInvoice');
  const returnPerm = usePermission('salesReturn');
  const movementPerm = usePermission('stockMovement');
  const soPerm = usePermission('salesOrder');
  const dlvPerm = usePermission('deliveryOrder');
  const canSeeCost = usePermission('vendorPrice').canView;
  const toast = useToast();
  const confirm = useConfirm();

  const [doc, setDoc] = useState(null);
  const [notFound, setNotFound] = useState(null);
  const [form, setForm] = useState(null);
  const [lines, setLines] = useState([]);
  const [savedPayload, setSavedPayload] = useState(null);
  const [gudangList, setGudangList] = useState([]);
  const [customerList, setCustomerList] = useState([]);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [cancelOpen, setCancelOpen] = useState(false);

  useEffect(() => {
    getGudangDropdown(user.token).then(setGudangList).catch(console.error);
    getCustomerDropdown(user.token).then(setCustomerList).catch(console.error);
  }, [user.token]);

  const applyDoc = useCallback((d) => {
    const f = {
      customer: d.customer?._id || '',
      gudang: d.gudang?._id || '',
      date: toDateInput(d.date),
      dueDate: d.dueDate ? toDateInput(d.dueDate) : '',
      dueTouched: true,
      note: d.note || '',
      taxRate: d.taxRate ?? 0,
      priceIncludesTax: !!d.priceIncludesTax,
      discountAmount: d.discountAmount || 0,
      shippingCharge: d.shippingCharge || 0, // hanya invoice dari surat jalan (ongkir SO)
    };
    const ls = d.lines.map(lineFromDoc);
    setDoc(d);
    setForm(f);
    setLines(ls);
    setSavedPayload(JSON.stringify(toPayload(f, ls)));
  }, []);

  const load = useCallback(async () => {
    try {
      applyDoc(await getSalesInvoice(id, user.token));
      setVersion((v) => v + 1);
    } catch (err) {
      const s = err.response?.status;
      if ([400, 403, 404].includes(s)) setNotFound(s === 403 ? err.response?.data?.message : 'Invoice mungkin sudah dihapus.');
      else console.error(err);
    }
  }, [id, user.token, applyDoc]);

  // dokumen baru: pajak dari System Settings
  useEffect(() => {
    if (!isNew) {
      load();
      return;
    }
    setDoc(null);
    setLines([]);
    setSavedPayload(null);
    setForm({ customer: '', gudang: '', date: toDateInput(), dueDate: '', dueTouched: false, note: '', taxRate: 0, priceIncludesTax: false, discountAmount: 0 });
    getSettings(user.token)
      .then(({ values }) => setForm((f) => ({
        ...f,
        taxRate: values['tax.isPKP'] !== false ? (values['tax.ppnRate'] ?? 0) : 0,
        priceIncludesTax: values['sales.priceIncludesTax'] === true,
      })))
      .catch(console.error);
  }, [isNew, load, user.token]);

  // default: customer walk-in & gudang satu-satunya
  const gudangOptions = gudangList.filter((g) => g.accessible !== false && (g.isActive !== false || g._id === form?.gudang));
  const customerOptions = customerList.filter((c) => c.isActive !== false || c._id === form?.customer);
  useEffect(() => {
    if (!isNew || !form) return;
    const patch = {};
    if (!form.customer) {
      const walkIn = customerList.find((c) => c.isWalkIn);
      if (walkIn) patch.customer = walkIn._id;
    }
    if (!form.gudang) {
      const active = gudangList.filter((g) => g.accessible !== false && g.isActive !== false);
      if (active.length === 1) patch.gudang = active[0]._id;
    }
    if (Object.keys(patch).length) setForm((f) => ({ ...f, ...patch }));
  }, [isNew, form, customerList, gudangList]);

  // jatuh tempo otomatis = tanggal + termin customer, selama belum diubah manual
  const termOf = (cid) => customerList.find((c) => c._id === cid)?.termDays || 0;
  const autoDue = (date, cid) => (date ? toDateInput(new Date(new Date(`${date}T00:00:00`).getTime() + termOf(cid) * 86400000)) : '');
  useEffect(() => {
    if (!form || form.dueTouched) return;
    const due = autoDue(form.date, form.customer);
    if (due !== form.dueDate) setForm((f) => ({ ...f, dueDate: due }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form?.date, form?.customer, form?.dueTouched, customerList]);

  const status = isNew ? 'DRAFT' : doc?.status;
  const isDraft = status === 'DRAFT';
  const editable = isNew ? perm.canCreate : isDraft && perm.canUpdate;
  const payload = form ? toPayload(form, lines) : null;
  const dirty = editable && (isNew ? lines.length > 0 : JSON.stringify(payload) !== savedPayload);
  const gudangCode = (gid) => gudangList.find((g) => g._id === gid)?.code || '';

  // ---------- baris ----------
  const existing = useMemo(() => new Set(lines.map((l) => l.sku._id)), [lines]);
  const addLines = (skus) => {
    const fresh = skus.filter((s) => !existing.has(s._id));
    if (!fresh.length) return toast.info('SKU tersebut sudah ada di invoice.');
    setLines((prev) => [...prev, ...fresh.map(lineFromSearch)]);
  };
  const setLine = (skuId, field, value) => setLines((prev) => prev.map((l) => (l.sku._id === skuId ? { ...l, [field]: value } : l)));
  const removeLine = (skuId) => setLines((prev) => prev.filter((l) => l.sku._id !== skuId));

  // cari SKU dengan harga untuk customer terpilih (price list)
  const searchWithPrice = useCallback(
    (token, params) => searchSalesSkus(token, { ...params, customer: form?.customer || undefined }),
    [form?.customer],
  );

  // ganti customer: harga baris mengikuti price list customer baru
  const changeCustomer = async (customer) => {
    setForm((f) => ({ ...f, customer }));
    if (!customer || !lines.length) return;
    try {
      const prices = await getSalesSkuPrices(user.token, customer, lines.map((l) => l.sku._id));
      let changed = 0;
      setLines((prev) => prev.map((l) => {
        const p = prices[l.sku._id];
        if (!p) return l;
        if (Number(l.hargaJual) !== p.price) changed++;
        return { ...l, hargaJual: p.price, priceSource: p.source };
      }));
      if (changed) toast.info('Harga baris diperbarui sesuai price list customer.');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load prices');
    }
  };

  const changeGudang = async (gudang) => {
    setForm((f) => ({ ...f, gudang }));
    if (!gudang || !lines.length) return;
    try {
      const balances = await getSalesSkuBalances(user.token, gudang, lines.map((l) => l.sku._id));
      setLines((prev) => prev.map((l) => ({ ...l, currentQty: balances[l.sku._id] ?? 0 })));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load stock balance');
    }
  };

  // total dokumen + HPP / margin (perkiraan selama draft)
  const totals = useMemo(() => (form ? salesTotals(lines, form) : null), [lines, form]);
  const summary = useMemo(() => {
    let over = 0;
    let belowCost = 0;
    let cost = 0;
    let costMissing = false;
    for (const l of lines) {
      const q = Number(l.qty) || 0;
      if (isDraft && hasValue(l.currentQty) && q > l.currentQty) over++;
      if (hasValue(l.unitCost)) {
        cost += q * l.unitCost;
        const net = salesLineSubtotal(l) / (q || 1);
        if (q > 0 && net < l.unitCost) belowCost++;
      } else if (q > 0) costMissing = true;
    }
    return { over, belowCost, cost: round2(cost), costMissing };
  }, [lines, isDraft]);
  const ratio = totals && totals.subtotal ? totals.dpp / totals.subtotal : 0; // pendapatan bersih / subtotal
  const cogs = !isDraft && hasValue(doc?.cogs) ? doc.cogs : summary.cost;
  const grossProfit = totals ? round2(totals.dpp - cogs) : 0;

  // ---------- aksi ----------
  const validate = () => {
    if (!form.customer) return 'Pilih customer.';
    if (!form.gudang) return 'Pilih gudang.';
    if (!lines.length) return 'Tambahkan minimal 1 SKU.';
    const bad = lines.find((l) => isBlank(l.qty) || Number(l.qty) <= 0);
    if (bad) return `${bad.sku.sku}: isi qty (> 0).`;
    const disc = lines.find((l) => Number(l.diskonPersen) < 0 || Number(l.diskonPersen) > 100);
    if (disc) return `${disc.sku.sku}: diskon 0 – 100%.`;
    if (Number(form.discountAmount) > totals.subtotal) return 'Diskon dokumen tidak boleh melebihi subtotal.';
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
      const res = isNew ? await createSalesInvoice(payload, user.token) : await updateSalesInvoice(id, payload, user.token);
      if (!quiet) toast.success(res.data.message);
      const saved = res.data.data;
      if (isNew && !stay) navigate(`/sales-invoice/${saved._id}`, { replace: true });
      else if (!stay) await load();
      return saved._id;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save invoice');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const post = async () => {
    const error = dirty || isNew ? validate() : null;
    if (error) return toast.warning(error);
    const warn = [
      summary.over ? `${summary.over} SKU melebihi stok gudang (posting akan ditolak).` : '',
      canSeeCost && summary.belowCost ? `${summary.belowCost} SKU dijual di bawah HPP.` : '',
    ].filter(Boolean).join(' ');
    const ok = await confirm({
      title: `Post ${doc?.no || 'invoice'}?`,
      message: `Penjualan ${formatRupiah(totals.total)}: stok ${lines.length} SKU keluar dari ${gudangCode(form.gudang)} sekarang. `
        + `Invoice yang sudah diposting tidak bisa diedit, hanya dibatalkan.${warn ? ` ${warn}` : ''}`,
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
      const res = await postSalesInvoice(docId, user.token);
      toast.success(res.data.message);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to post invoice');
    } finally {
      setBusy(false);
      if (isNew) navigate(`/sales-invoice/${docId}`, { replace: true });
      else await load();
    }
  };

  const removeDraft = async () => {
    const ok = await confirm({ title: `Delete ${doc.no}?`, message: 'Draft ini akan dihapus permanen. Stok tidak terpengaruh.', confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
    try {
      const res = await deleteSalesInvoice(id, user.token);
      toast.success(res.data.message);
      navigate('/sales-invoice');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete invoice');
    }
  };

  const cancelDoc = async (reason) => {
    setBusy(true);
    try {
      const res = await cancelSalesInvoice(id, reason, user.token);
      toast.success(res.data.message);
      setCancelOpen(false);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to cancel invoice');
    } finally {
      setBusy(false);
    }
  };

  // ---------- render ----------
  if (notFound) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <p className="text-xl font-semibold text-fg mb-1">Invoice not available</p>
        <p className="text-muted mb-6">{notFound}</p>
        <Link to="/sales-invoice" className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded">
          <i className="fa fa-arrow-left"></i> Back to Sales Invoice
        </Link>
      </div>
    );
  }
  if (!form) return <div className="p-6 text-muted">Loading...</div>;
  if (isNew && perm.loaded && !perm.canCreate) {
    return <div className="p-6 text-muted">You don&apos;t have permission to create sales invoices.</div>;
  }

  const colSpan = 8 + (isDraft ? 1 : 0) + (canSeeCost ? 2 : 0);
  const customer = customerList.find((c) => c._id === form.customer) || doc?.customer;

  return (
    <div className="h-full p-4 flex flex-col overflow-auto">
      <PageHeader
        fallbackTitle="Sales Invoice"
        parentPath="/sales-invoice"
        title={doc?.no || 'New Invoice'}
        subtitle={doc?.source === 'SALES_ORDER' ? 'Tagihan atas surat jalan: stok sudah keluar di Delivery Order.' : 'Penjualan langsung: stok keluar dari gudang saat diposting.'}
        actions={(
          <>
            {!isNew && <StatusBadge status={status} meta={INVOICE_STATUS_META} />}
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
                <i className="fa fa-check"></i> {dirty || isNew ? 'Save & Post' : 'Post'}
              </button>
            )}
            {status === 'POSTED' && returnPerm.canCreate && lines.some((l) => Number(l.qty) > (l.qtyReturned || 0)) && (
              <button type="button" onClick={() => navigate(`/sales-return/new?invoice=${doc._id}`)} disabled={busy} className={btnGhost}>
                <i className="fa fa-rotate-left"></i> Return
              </button>
            )}
            {status === 'POSTED' && perm.canPost && (
              <button type="button" onClick={() => setCancelOpen((o) => !o)} disabled={busy} className={btnDanger}>
                <i className="fa fa-ban"></i> Cancel invoice
              </button>
            )}
          </>
        )}
      />

      {cancelOpen && (
        <ReasonPanel
          title={`Cancel ${doc.no}`}
          description={doc.source === 'SALES_ORDER'
            ? `Tagihan dibatalkan; stok tidak berubah (barang tetap terkirim lewat ${doc.deliveryOrder?.no || 'surat jalan'}) dan surat jalan bisa ditagih ulang.`
            : `Stok dikembalikan ke ${doc.gudang?.code} dengan HPP saat dijual (pergerakan pembalik).`}
          placeholder="Alasan pembatalan (wajib)"
          confirmLabel="Cancel invoice"
          busy={busy}
          onConfirm={cancelDoc}
          onClose={() => setCancelOpen(false)}
        />
      )}

      {isDraft && !isNew && !editable && (
        <p className="mb-4 text-sm px-3 py-2 rounded bg-subtle text-muted max-w-3xl">
          <i className="fa fa-lock mr-1.5"></i> Draft ini hanya bisa dilihat (tidak ada izin mengubah).
        </p>
      )}

      <div className={`grid gap-4 items-start ${doc ? 'xl:grid-cols-[minmax(0,1fr)_320px]' : ''}`}>
        <div className="space-y-4 min-w-0">
          <section className="rounded-lg border border-line bg-surface p-4">
            <fieldset disabled={!editable || busy} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <FormField label="Customer" htmlFor="inv-customer" required>
                <select id="inv-customer" value={form.customer} onChange={(e) => changeCustomer(e.target.value)} className={inputClass}>
                  <option value="">— choose —</option>
                  {customerOptions.map((c) => (
                    <option key={c._id} value={c._id}>{c.name}{c.isActive === false ? ' (inactive)' : ''}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Warehouse" htmlFor="inv-gudang" required>
                <select id="inv-gudang" value={form.gudang} onChange={(e) => changeGudang(e.target.value)} className={inputClass}>
                  <option value="">— choose —</option>
                  {(editable ? gudangOptions : gudangList.filter((g) => g._id === form.gudang)).map((g) => (
                    <option key={g._id} value={g._id}>{g.code} — {g.name}{g.isActive === false ? ' (inactive)' : ''}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Date" htmlFor="inv-date" required>
                <input id="inv-date" type="date" max={toDateInput()} value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className={inputClass} />
              </FormField>
              <FormField label="Due date" htmlFor="inv-due" hint={form.dueTouched ? undefined : `Termin customer ${termOf(form.customer)} hari`}>
                <input id="inv-due" type="date" min={form.date} value={form.dueDate}
                  onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value, dueTouched: true }))} className={inputClass} />
              </FormField>
              <FormField label="Note" htmlFor="inv-note">
                <input id="inv-note" value={form.note} placeholder="Optional"
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className={inputClass} />
              </FormField>
            </fieldset>
          </section>

          <section className="rounded-lg border border-line bg-surface">
            <div className="px-4 py-3 border-b border-line">
              <h3 className="font-semibold text-fg">Items ({lines.length})</h3>
              <p className="text-xs text-muted">
                Qty & harga per satuan dasar, maks. 2 desimal. Harga dari price list customer / harga jual SKU dan tidak bisa diubah; potongan harga lewat diskon.
              </p>
            </div>

            {editable && (
              <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-line-soft bg-subtle">
                {form.gudang
                  ? <SkuPicker token={user.token} gudang={form.gudang} existing={existing} onAdd={addLines} searchFn={searchWithPrice} />
                  : <span className="text-sm text-muted">Pilih gudang dulu untuk menambah SKU.</span>}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: canSeeCost ? 1080 : 880 }}>
                <thead className="bg-head text-head-fg text-left">
                  <tr>
                    <th className="px-2 py-2 border-b border-line font-semibold w-10 text-right">#</th>
                    <th className="px-2 py-2 border-b border-line font-semibold">SKU</th>
                    {isDraft && <th className="px-2 py-2 border-b border-line font-semibold w-28 text-right" title="Saldo saat ini di gudang">Available</th>}
                    <th className="px-2 py-2 border-b border-line font-semibold w-24 text-right">Qty</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-32 text-right">Price</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-20 text-right">Disc %</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-32 text-right">Subtotal</th>
                    {canSeeCost && (
                      <>
                        <th className="px-2 py-2 border-b border-line font-semibold w-28 text-right" title={isDraft ? 'HPP saat ini (perkiraan)' : 'HPP saat diposting'}>HPP{isDraft ? ' (est.)' : ''}</th>
                        <th className="px-2 py-2 border-b border-line font-semibold w-32 text-right" title="Pendapatan bersih (tanpa PPN, setelah diskon dokumen) - HPP">Margin</th>
                      </>
                    )}
                    <th className="px-2 py-2 border-b border-line font-semibold w-44">Note</th>
                    {editable && <th className="px-2 py-2 border-b border-line w-10"></th>}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, index) => {
                    const q = Number(l.qty) || 0;
                    const over = isDraft && hasValue(l.currentQty) && q > l.currentQty;
                    const sub = salesLineSubtotal(l);
                    const cost = hasValue(l.unitCost) ? round2(q * l.unitCost) : null;
                    const margin = cost === null ? null : round2(sub * ratio - cost);
                    const below = hasValue(l.unitCost) && q > 0 && sub / q < l.unitCost;
                    return (
                      <tr key={l.sku._id || index} className={`align-top ${over ? 'bg-danger-soft' : 'hover:bg-subtle'}`}>
                        <td className="px-2 py-1.5 border-t border-line-soft text-right text-muted tabular-nums">{index + 1}</td>
                        <td className="px-2 py-1.5 border-t border-line-soft">
                          <div className="font-mono text-xs font-semibold text-fg">
                            {l.sku.sku}
                            {!l.sku.isActive && <span className="ml-1.5 font-sans text-[10px] px-1 rounded bg-subtle text-muted">inactive</span>}
                          </div>
                          <div className="text-xs text-muted truncate max-w-64">{l.sku.produkName} · {l.sku.variant}</div>
                        </td>
                        {isDraft && (
                          <td className={`px-2 py-1.5 border-t border-line-soft text-right tabular-nums ${over ? 'text-danger font-semibold' : 'text-muted'}`}>
                            {hasValue(l.currentQty) ? `${formatNumber(l.currentQty)} ${l.sku.uom}` : '-'}
                          </td>
                        )}
                        <td className="px-2 py-1.5 border-t border-line-soft text-right">
                          {editable ? (
                            <input aria-label={`Qty ${l.sku.sku}`} type="number" min="0.01" step="0.01" value={l.qty} disabled={busy}
                              onChange={(e) => setLine(l.sku._id, 'qty', e.target.value)} className={`${cellInput} text-right tabular-nums`} />
                          ) : <span className="tabular-nums">{formatNumber(l.qty)}</span>}
                          {l.qtyReturned > 0 && <div className="text-[10px] text-danger mt-0.5">returned {formatNumber(l.qtyReturned)}</div>}
                        </td>
                        <td className="px-2 py-1.5 border-t border-line-soft text-right"
                          title={editable ? 'Harga dari price list customer / harga jual SKU (tidak bisa diubah; pakai kolom diskon)' : undefined}>
                          <span className={`tabular-nums ${editable ? 'inline-block py-1' : ''}`}>{formatRupiah(l.hargaJual)}</span>
                          {editable && l.priceSource === 'list' && <div className="text-[10px] text-primary mt-0.5">price list</div>}
                          {canSeeCost && isDraft && below && <div className="text-[10px] text-warning-fg mt-0.5">di bawah HPP</div>}
                        </td>
                        <td className="px-2 py-1.5 border-t border-line-soft text-right">
                          {editable ? (
                            <input aria-label={`Discount ${l.sku.sku}`} type="number" min="0" max="100" step="0.01" value={l.diskonPersen} disabled={busy}
                              onChange={(e) => setLine(l.sku._id, 'diskonPersen', e.target.value)} className={`${cellInput} text-right tabular-nums`} />
                          ) : <span className="tabular-nums">{l.diskonPersen ? formatNumber(l.diskonPersen) : '-'}</span>}
                        </td>
                        <td className="px-2 py-1.5 border-t border-line-soft text-right tabular-nums font-medium">{formatRupiah(sub)}</td>
                        {canSeeCost && (
                          <>
                            <td className="px-2 py-1.5 border-t border-line-soft text-right tabular-nums text-muted">
                              {hasValue(l.unitCost) ? formatRupiah(l.unitCost) : <span title="HPP belum ada">-</span>}
                            </td>
                            <td className={`px-2 py-1.5 border-t border-line-soft text-right tabular-nums ${margin !== null && margin < 0 ? 'text-danger' : ''}`}>
                              {margin === null ? '-' : formatRupiah(margin)}
                            </td>
                          </>
                        )}
                        <td className="px-2 py-1.5 border-t border-line-soft">
                          <input aria-label={`Note ${l.sku.sku}`} value={l.note} maxLength={200} disabled={!editable || busy}
                            onChange={(e) => setLine(l.sku._id, 'note', e.target.value)} className={cellInput} />
                        </td>
                        {editable && (
                          <td className="px-2 py-1.5 border-t border-line-soft text-center">
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

            {(summary.over > 0 || (canSeeCost && isDraft && summary.belowCost > 0)) && (
              <div className="px-4 py-2 border-t border-line text-sm space-y-0.5">
                {summary.over > 0 && (
                  <p className="text-danger"><i className="fa fa-triangle-exclamation mr-1"></i>{summary.over} SKU melebihi stok gudang: posting akan ditolak.</p>
                )}
                {canSeeCost && isDraft && summary.belowCost > 0 && (
                  <p className="text-warning-fg"><i className="fa fa-circle-exclamation mr-1"></i>{summary.belowCost} SKU dijual di bawah HPP.</p>
                )}
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-6 px-4 py-3 border-t border-line text-sm">
              <fieldset disabled={!editable || busy} className="space-y-2 min-w-56">
                <label className="flex items-center justify-between gap-3">
                  <span className="text-muted">Document discount (Rp)</span>
                  <input aria-label="Document discount" type="number" min="0" step="0.01" value={form.discountAmount}
                    onChange={(e) => setForm((f) => ({ ...f, discountAmount: e.target.value }))}
                    className={`${cellInput} w-36 text-right tabular-nums`} />
                </label>
                <label className="flex items-center justify-between gap-3">
                  <span className="text-muted">PPN (%)</span>
                  <input aria-label="Tax rate" type="number" min="0" max="100" step="0.01" value={form.taxRate}
                    onChange={(e) => setForm((f) => ({ ...f, taxRate: e.target.value }))}
                    className={`${cellInput} w-36 text-right tabular-nums`} />
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.priceIncludesTax}
                    onChange={(e) => setForm((f) => ({ ...f, priceIncludesTax: e.target.checked }))} className="w-4 h-4 accent-primary" />
                  <span className="text-muted">Harga sudah termasuk PPN</span>
                </label>
              </fieldset>

              <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 min-w-64">
                <dt className="text-muted">Subtotal</dt><dd className="text-right tabular-nums">{formatRupiah(totals.subtotal)}</dd>
                {totals.discountAmount > 0 && (<><dt className="text-muted">Discount</dt><dd className="text-right tabular-nums">−{formatRupiah(totals.discountAmount)}</dd></>)}
                <dt className="text-muted" title="Dasar pengenaan pajak = penjualan bersih">DPP</dt><dd className="text-right tabular-nums">{formatRupiah(totals.dpp)}</dd>
                {totals.shippingCharge > 0 && (
                  <><dt className="text-muted" title="Ongkir dari sales order (tanpa PPN); tidak termasuk penjualan barang">Shipping</dt><dd className="text-right tabular-nums">{formatRupiah(totals.shippingDpp)}</dd></>
                )}
                <dt className="text-muted">PPN {formatNumber(Number(form.taxRate) || 0)}%{form.priceIncludesTax ? ' (incl.)' : ''}</dt>
                <dd className="text-right tabular-nums">{formatRupiah(totals.taxAmount)}</dd>
                <dt className="font-semibold">Total</dt><dd className="text-right tabular-nums font-semibold">{formatRupiah(totals.total)}</dd>
                {canSeeCost && (
                  <>
                    <dt className="text-muted pt-2 border-t border-line-soft">HPP{isDraft ? ' (est.)' : ''}</dt>
                    <dd className="text-right tabular-nums pt-2 border-t border-line-soft">{formatRupiah(cogs)}{summary.costMissing && isDraft ? '*' : ''}</dd>
                    <dt className="text-muted">Gross profit</dt>
                    <dd className={`text-right tabular-nums font-medium ${grossProfit < 0 ? 'text-danger' : ''}`}>
                      {formatRupiah(grossProfit)}
                      {totals.dpp > 0 && <span className="text-xs text-muted ml-1">({formatNumber(round2((grossProfit / totals.dpp) * 100))}%)</span>}
                    </dd>
                    {summary.costMissing && isDraft && <dd className="col-span-2 text-[11px] text-muted">* ada SKU tanpa HPP (dihitung 0)</dd>}
                  </>
                )}
              </dl>
            </div>
          </section>
        </div>

        {doc && (
          <aside className="space-y-4 min-w-0">
            <section className="rounded-lg border border-line bg-surface p-4 text-sm space-y-2">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                <dt className="text-muted">Status</dt><dd><StatusBadge status={doc.status} meta={INVOICE_STATUS_META} /></dd>
                <dt className="text-muted">Customer</dt>
                <dd className="break-words">
                  {customer?.name || '-'}
                  {doc.customer?.phone && <div className="text-xs text-muted">{doc.customer.phone}</div>}
                  {doc.customer?.address && <div className="text-xs text-muted">{doc.customer.address}</div>}
                  {doc.customer?.npwp && <div className="text-xs text-muted">NPWP {doc.customer.npwp}</div>}
                </dd>
                {doc.salesOrder && (
                  <>
                    <dt className="text-muted">Sales order</dt>
                    <dd>
                      {soPerm.canView
                        ? <Link to={`/sales-order/${doc.salesOrder._id}`} className="font-mono text-xs font-semibold text-primary hover:underline">{doc.salesOrder.no}</Link>
                        : <span className="font-mono text-xs">{doc.salesOrder.no}</span>}
                      {doc.salesOrder.customerPoNo && <span className="text-xs text-muted"> · PO {doc.salesOrder.customerPoNo}</span>}
                    </dd>
                  </>
                )}
                {doc.deliveryOrder && (
                  <>
                    <dt className="text-muted">Delivery</dt>
                    <dd>
                      {dlvPerm.canView
                        ? <Link to={`/delivery-order/${doc.deliveryOrder._id}`} className="font-mono text-xs font-semibold text-primary hover:underline">{doc.deliveryOrder.no}</Link>
                        : <span className="font-mono text-xs">{doc.deliveryOrder.no}</span>}
                      <span className="text-xs text-muted"> · {formatDay(doc.deliveryOrder.date)}</span>
                    </dd>
                  </>
                )}
                {doc.postedDate && (<><dt className="text-muted">Posted</dt><dd>{formatDate2(doc.postedDate)} · {doc.postedBy?.name || '-'}</dd></>)}
                {doc.cancelledDate && (<><dt className="text-muted">Cancelled</dt><dd>{formatDate2(doc.cancelledDate)} · {doc.cancelledBy?.name || '-'}</dd></>)}
                {doc.cancelReason && (<><dt className="text-muted">Reason</dt><dd className="break-words">{doc.cancelReason}</dd></>)}
              </dl>
              {doc.status === 'POSTED' && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pt-2 border-t border-line-soft">
                  <dt className="text-muted">Payment</dt>
                  <dd>{doc.paymentStatus && <StatusBadge status={doc.paymentStatus} meta={PAYMENT_STATUS_META} />}</dd>
                  <dt className="text-muted">Due date</dt>
                  <dd className={`text-right ${doc.overdue ? 'text-danger font-semibold' : ''}`}>
                    {doc.dueDate ? formatDay(doc.dueDate) : '-'}{doc.overdue ? ' · overdue' : ''}
                  </dd>
                  <dt className="text-muted">Total</dt><dd className="text-right tabular-nums">{formatRupiah(doc.total)}</dd>
                  {doc.returnedAmount > 0 && (<><dt className="text-muted">Returned</dt><dd className="text-right tabular-nums">−{formatRupiah(doc.returnedAmount)}</dd></>)}
                  {doc.paidAmount !== 0 && (<><dt className="text-muted">Paid</dt><dd className="text-right tabular-nums">−{formatRupiah(doc.paidAmount)}</dd></>)}
                  <dt className="font-semibold">Balance</dt>
                  <dd className={`text-right tabular-nums font-semibold ${doc.balance < 0 ? 'text-danger' : ''}`}>{formatRupiah(doc.balance)}</dd>
                </dl>
              )}
              {doc.returns?.length > 0 && (
                <div className="pt-2 border-t border-line-soft">
                  <div className="text-xs font-semibold text-muted mb-1">Returns</div>
                  <ul className="space-y-1">
                    {doc.returns.map((r) => (
                      <li key={r._id} className="flex items-center justify-between gap-2">
                        {returnPerm.canView
                          ? <Link to={`/sales-return/${r._id}`} className="font-mono text-xs font-semibold text-primary hover:underline">{r.no}</Link>
                          : <span className="font-mono text-xs">{r.no}</span>}
                        <span className="text-xs tabular-nums">{formatRupiah(r.total)}</span>
                        <StatusBadge status={r.status} meta={RETURN_STATUS_META} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {doc.status !== 'DRAFT' && movementPerm.canView && (
                <Link to={`/stock-movement?search=${encodeURIComponent(doc.deliveryOrder?.no || doc.no)}`} className="inline-block text-primary hover:underline">
                  <i className="fa fa-right-left mr-1"></i> View stock movements
                </Link>
              )}
            </section>
            {doc.status === 'POSTED' && <InvoicePayments doc={doc} token={user.token} onChanged={load} />}
            <AuditDetail data={doc} />
            <section className="rounded-lg border border-line bg-surface p-4">
              <h3 className="font-semibold text-fg mb-2">History</h3>
              <AuditTimeline entity="salesInvoice" id={doc._id} refreshKey={version} />
            </section>
          </aside>
        )}
      </div>
    </div>
  );
}
