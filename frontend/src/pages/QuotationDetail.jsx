import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  getQuotation, createQuotation, updateQuotation, deleteQuotation, sendQuotation, reviseQuotation, rejectQuotation,
  convertQuotation, searchQuotationSkus, getQuotationSkuPrices, getCustomerDropdown,
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
import { AuditDetail } from '../components/AuditInfo';
import { inputClass } from '../utils/formStyles';
import { formatNumber, formatRupiah, variantLabel } from '../utils/formatHelper';
import { formatDate2, formatDay, toDateInput } from '../utils/dateHelper';
import { QUOTATION_STATUS_META, SO_STATUS_META, DELIVERY_METHODS, quotationStatus, salesLineSubtotal, salesTotals } from '../utils/salesMeta';
import { printQuotation } from '../utils/documentPrint';

const cellInput = `w-full bg-input text-fg border border-line rounded px-2 py-1 text-sm
  focus:outline-none focus:border-primary disabled:bg-transparent disabled:border-transparent`;
const btn = 'px-4 py-2 rounded text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
const btnGhost = `${btn} border border-line hover:bg-subtle`;
const btnPrimary = `${btn} bg-primary hover:bg-primary-hover text-primary-fg`;
const btnDanger = `${btn} border border-danger-line text-danger hover:bg-danger-soft`;
const VALID_DAYS = 14;

const isBlank = (v) => v === '' || v === null || v === undefined;
const hasValue = (v) => v !== null && v !== undefined;
const plusDays = (dateStr, days) => toDateInput(new Date(new Date(`${dateStr}T00:00:00`).getTime() + days * 86400000));

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
});

const lineFromSearch = (s) => ({
  sku: { _id: s._id, sku: s.sku, produkName: s.produk?.name || '', variant: s.variant, uom: s.uom, isActive: s.isActive },
  qty: 1,
  hargaJual: s.hargaJual ?? '',
  diskonPersen: 0,
  note: '',
  available: s.available ?? s.qty,
  priceSource: s.priceSource || 'default',
});

const toPayload = (form, lines) => ({
  customer: form.customer,
  prospectName: form.prospectName,
  prospectContact: form.prospectContact,
  gudang: form.gudang,
  date: form.date,
  validUntil: form.validUntil,
  deliveryMethod: form.deliveryMethod,
  note: form.note,
  terms: form.terms,
  taxRate: form.taxRate,
  priceIncludesTax: form.priceIncludesTax,
  discountAmount: form.discountAmount || 0,
  shippingCharge: form.deliveryMethod === 'DELIVERY' ? (form.shippingCharge || 0) : 0,
  // harga tidak dikirim: backend mengisinya dari price list / harga jual SKU (dibekukan, dikunci saat dikirim)
  lines: lines.map((l) => ({ sku: l.sku._id, qty: l.qty, diskonPersen: l.diskonPersen || 0, note: l.note })),
});

/** Panel konversi ke Sales Order; quotation walk-in wajib memilih customer bernama */
function ConvertPanel({ doc, customers, busy, onConfirm, onClose }) {
  const walkIn = doc.customer?.isWalkIn;
  const [customer, setCustomer] = useState('');
  return (
    <section className="mb-4 rounded-lg border border-primary bg-surface p-4 max-w-3xl space-y-3">
      <div>
        <h3 className="font-semibold text-fg">Convert {doc.no} to Sales Order</h3>
        <p className="text-sm text-muted">
          Sales Order draft dibuat dengan harga penawaran ini (berlaku s/d {formatDay(doc.validUntil)}), lalu bisa dilengkapi
          (PO customer, tanggal kirim, alamat) sebelum dikonfirmasi. Quotation menjadi Accepted.
        </p>
      </div>
      {walkIn && (
        <FormField label="Customer" htmlFor="conv-customer" required hint={`Penawaran untuk calon pembeli "${doc.prospectName}": pilih / buat customer-nya dulu.`}>
          <select id="conv-customer" value={customer} onChange={(e) => setCustomer(e.target.value)} className={inputClass}>
            <option value="">— choose —</option>
            {customers.filter((c) => !c.isWalkIn && c.isActive !== false).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </select>
        </FormField>
      )}
      <div className="flex gap-2">
        <button type="button" disabled={busy || (walkIn && !customer)} onClick={() => onConfirm(walkIn ? { customer } : {})} className={btnPrimary}>
          <i className="fa fa-file-signature"></i> Create Sales Order
        </button>
        <button type="button" disabled={busy} onClick={onClose} className={btnGhost}>Close</button>
      </div>
    </section>
  );
}

/**
 * Quotation: /quotation/:id (id = 'new')
 *   Draft  : customer (walk-in = calon pembeli), gudang, berlaku s/d, metode, baris (harga dibekukan), diskon, ongkir, PPN, syarat
 *   Send   : harga dikunci; Revise kembali ke draft (mis. memperpanjang masa berlaku); Reject dengan alasan
 *   Convert: Sales Order draft dengan harga penawaran (selama masih berlaku)
 */
export default function QuotationDetail() {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const { user } = useAuth();
  const perm = usePermission('quotation');
  const soPerm = usePermission('salesOrder');
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
  const [panel, setPanel] = useState(null); // 'reject' | 'convert'

  useEffect(() => {
    getGudangDropdown(user.token).then(setGudangList).catch(console.error);
    getCustomerDropdown(user.token).then(setCustomerList).catch(console.error);
  }, [user.token]);

  const applyDoc = useCallback((d) => {
    const f = {
      customer: d.customer?._id || '',
      prospectName: d.prospectName || '',
      prospectContact: d.prospectContact || '',
      gudang: d.gudang?._id || '',
      date: toDateInput(d.date),
      validUntil: toDateInput(d.validUntil),
      deliveryMethod: d.deliveryMethod || 'DELIVERY',
      note: d.note || '',
      terms: d.terms || '',
      taxRate: d.taxRate ?? 0,
      priceIncludesTax: !!d.priceIncludesTax,
      discountAmount: d.discountAmount || 0,
      shippingCharge: d.shippingCharge || 0,
    };
    const ls = d.lines.map(lineFromDoc);
    setDoc(d);
    setForm(f);
    setLines(ls);
    setSavedPayload(JSON.stringify(toPayload(f, ls)));
    setPanel(null);
  }, []);

  const load = useCallback(async () => {
    try {
      applyDoc(await getQuotation(id, user.token));
      setVersion((v) => v + 1);
    } catch (err) {
      const s = err.response?.status;
      if ([400, 403, 404].includes(s)) setNotFound(s === 403 ? err.response?.data?.message : 'Quotation mungkin sudah dihapus.');
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
    const today = toDateInput();
    setForm({
      customer: '', prospectName: '', prospectContact: '', gudang: '', date: today, validUntil: plusDays(today, VALID_DAYS),
      deliveryMethod: 'DELIVERY', note: '', terms: '', taxRate: 0, priceIncludesTax: false, discountAmount: 0, shippingCharge: 0,
    });
    getSettings(user.token)
      .then(({ values }) => setForm((f) => ({
        ...f,
        taxRate: values['tax.isPKP'] !== false ? (values['tax.ppnRate'] ?? 0) : 0,
        priceIncludesTax: values['sales.priceIncludesTax'] === true,
      })))
      .catch(console.error);
  }, [isNew, load, user.token]);

  const gudangOptions = gudangList.filter((g) => g.accessible !== false && (g.isActive !== false || g._id === form?.gudang));
  const customerOptions = customerList.filter((c) => c.isActive !== false || c._id === form?.customer);
  useEffect(() => {
    if (!isNew || !form || form.gudang) return;
    const active = gudangList.filter((g) => g.accessible !== false && g.isActive !== false);
    if (active.length === 1) setForm((f) => ({ ...f, gudang: active[0]._id }));
  }, [isNew, form, gudangList]);

  const viewStatus = isNew ? 'DRAFT' : quotationStatus(doc);
  const isDraft = isNew || doc?.status === 'DRAFT';
  const isSent = doc?.status === 'SENT';
  const editable = isNew ? perm.canCreate : isDraft && perm.canUpdate;
  const payload = form ? toPayload(form, lines) : null;
  const dirty = editable && (isNew ? lines.length > 0 : JSON.stringify(payload) !== savedPayload);
  const customer = customerList.find((c) => c._id === form?.customer) || doc?.customer;
  const walkIn = !!customer?.isWalkIn;
  const delivery = form?.deliveryMethod === 'DELIVERY';

  // ---------- baris ----------
  const existing = useMemo(() => new Set(lines.map((l) => l.sku._id)), [lines]);
  const addLines = (skus) => {
    const fresh = skus.filter((s) => !existing.has(s._id));
    if (!fresh.length) return toast.info('SKU tersebut sudah ada di quotation.');
    setLines((prev) => [...prev, ...fresh.map(lineFromSearch)]);
  };
  const setLine = (skuId, field, value) => setLines((prev) => prev.map((l) => (l.sku._id === skuId ? { ...l, [field]: value } : l)));
  const removeLine = (skuId) => setLines((prev) => prev.filter((l) => l.sku._id !== skuId));
  const searchFn = useCallback(
    (token, params) => searchQuotationSkus(token, { ...params, customer: form?.customer || undefined }),
    [form?.customer],
  );

  // ganti customer: harga baris mengikuti price list customer baru
  const changeCustomer = async (cust) => {
    setForm((f) => ({ ...f, customer: cust }));
    if (!cust || !lines.length) return;
    try {
      const prices = await getQuotationSkuPrices(user.token, cust, lines.map((l) => l.sku._id));
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

  const totals = useMemo(() => (form ? salesTotals(lines, {
    ...form, shippingCharge: form.deliveryMethod === 'DELIVERY' ? form.shippingCharge : 0,
  }) : null), [lines, form]);

  // ---------- aksi ----------
  const validate = () => {
    if (!form.customer) return 'Pilih customer (atau Walk-in untuk calon pembeli).';
    if (walkIn && !form.prospectName.trim()) return 'Isi nama calon pembeli.';
    if (!form.gudang) return 'Pilih gudang.';
    if (!form.validUntil || form.validUntil < form.date) return 'Tanggal berlaku harus >= tanggal quotation.';
    if (!lines.length) return 'Tambahkan minimal 1 SKU.';
    const bad = lines.find((l) => isBlank(l.qty) || Number(l.qty) <= 0);
    if (bad) return `${bad.sku.sku}: isi qty (> 0).`;
    const disc = lines.find((l) => Number(l.diskonPersen) < 0 || Number(l.diskonPersen) > 100);
    if (disc) return `${disc.sku.sku}: diskon 0 – 100%.`;
    if (Number(form.discountAmount) > totals.subtotal) return 'Diskon dokumen tidak boleh melebihi subtotal.';
    return null;
  };

  const run = async (fn, fallback) => {
    setBusy(true);
    try {
      const res = await fn();
      toast.success(res.data.message);
      return res;
    } catch (err) {
      toast.error(err.response?.data?.message || fallback);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const save = async ({ send = false } = {}) => {
    const error = validate();
    if (error) return toast.warning(error);
    const body = { ...payload, send };
    const res = await run(() => (isNew ? createQuotation(body, user.token) : updateQuotation(id, body, user.token)), 'Failed to save quotation');
    if (!res) return;
    if (isNew) navigate(`/quotation/${res.data.data._id}`, { replace: true });
    else await load();
  };

  const sendIt = async () => {
    const error = dirty || isNew ? validate() : null;
    if (error) return toast.warning(error);
    const ok = await confirm({
      title: `Send ${doc?.no || 'quotation'}?`,
      message: `Penawaran ${formatRupiah(totals.total)} berlaku s/d ${formatDay(form.validUntil)}. Setelah dikirim harga dikunci; `
        + 'untuk mengubah, gunakan Revise.',
      confirmLabel: dirty || isNew ? 'Save & Send' : 'Send',
    });
    if (!ok) return;
    if (dirty || isNew) return save({ send: true });
    if (await run(() => sendQuotation(id, user.token), 'Failed to send quotation')) await load();
  };

  const revise = async () => {
    const ok = await confirm({
      title: `Revise ${doc.no}?`,
      message: 'Quotation kembali menjadi draft: isi bisa diubah dan harga dihitung ulang dari price list / harga jual saat ini.',
      confirmLabel: 'Revise',
    });
    if (ok && await run(() => reviseQuotation(id, user.token), 'Failed to revise quotation')) await load();
  };

  const removeDraft = async () => {
    const ok = await confirm({ title: `Delete ${doc.no}?`, message: 'Draft ini akan dihapus permanen.', confirmLabel: 'Delete', tone: 'danger' });
    if (ok && await run(() => deleteQuotation(id, user.token), 'Failed to delete quotation')) navigate('/quotation');
  };

  const reject = async (reason) => {
    if (await run(() => rejectQuotation(id, reason, user.token), 'Failed')) await load();
  };

  const convert = async (body) => {
    const res = await run(() => convertQuotation(id, body, user.token), 'Failed to convert quotation');
    if (res) navigate(`/sales-order/${res.data.data.salesOrder._id}`);
  };

  const printDoc = async () => {
    let company = {};
    try {
      company = (await getSettings(user.token)).values;
    } catch (err) {
      console.error(err);
    }
    printQuotation(doc, company);
  };

  // ---------- render ----------
  if (notFound) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <p className="text-xl font-semibold text-fg mb-1">Quotation not available</p>
        <p className="text-muted mb-6">{notFound}</p>
        <Link to="/quotation" className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded">
          <i className="fa fa-arrow-left"></i> Back to Quotation
        </Link>
      </div>
    );
  }
  if (!form) return <div className="p-6 text-muted">Loading...</div>;
  if (isNew && perm.loaded && !perm.canCreate) {
    return <div className="p-6 text-muted">You don&apos;t have permission to create quotations.</div>;
  }

  return (
    <div className="h-full p-4 flex flex-col overflow-auto">
      <PageHeader
        fallbackTitle="Quotation"
        parentPath="/quotation"
        title={doc?.no || 'New Quotation'}
        subtitle="Penawaran harga: tidak mengubah stok; harga dikunci saat dikirim dan dipakai Sales Order hasil konversi."
        actions={(
          <>
            {!isNew && <StatusBadge status={viewStatus} meta={QUOTATION_STATUS_META} />}
            {doc && (
              <button type="button" onClick={printDoc} disabled={busy} className={btnGhost} title="Cetak penawaran">
                <i className="fa fa-print"></i> Print
              </button>
            )}
            {isDraft && !isNew && perm.canDelete && (
              <button type="button" onClick={removeDraft} disabled={busy} className={btnDanger}><i className="fa fa-trash"></i> Delete</button>
            )}
            {editable && (
              <button type="button" onClick={() => save()} disabled={busy || (!isNew && !dirty)} className={btnGhost}>
                <i className="fa fa-save"></i> Save draft
              </button>
            )}
            {editable && (
              <button type="button" onClick={sendIt} disabled={busy || !lines.length} className={btnPrimary}>
                <i className="fa fa-paper-plane"></i> {dirty || isNew ? 'Save & Send' : 'Send'}
              </button>
            )}
            {isSent && perm.canUpdate && (
              <button type="button" onClick={revise} disabled={busy} className={btnGhost}><i className="fa fa-pen"></i> Revise</button>
            )}
            {isSent && perm.canUpdate && (
              <button type="button" onClick={() => setPanel((p) => (p === 'reject' ? null : 'reject'))} disabled={busy} className={btnDanger}>
                <i className="fa fa-thumbs-down"></i> Rejected
              </button>
            )}
            {isSent && !doc.expired && perm.canUpdate && soPerm.canCreate && (
              <button type="button" onClick={() => setPanel((p) => (p === 'convert' ? null : 'convert'))} disabled={busy} className={btnPrimary}>
                <i className="fa fa-file-signature"></i> Convert to SO
              </button>
            )}
          </>
        )}
      />

      {panel === 'reject' && (
        <ReasonPanel
          title={`Mark ${doc.no} as rejected`}
          description="Customer menolak / tidak melanjutkan penawaran ini."
          placeholder="Alasan (wajib), mis. harga kompetitor lebih murah"
          confirmLabel="Mark rejected"
          icon="fa-thumbs-down"
          busy={busy}
          onConfirm={reject}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'convert' && <ConvertPanel doc={doc} customers={customerList} busy={busy} onConfirm={convert} onClose={() => setPanel(null)} />}

      {doc?.expired && (
        <p className="mb-4 text-sm px-3 py-2 rounded bg-warning-soft text-warning-fg max-w-3xl">
          <i className="fa fa-hourglass-end mr-1.5"></i>
          Masa berlaku sudah lewat ({formatDay(doc.validUntil)}). Revise untuk memperpanjang (harga dihitung ulang), atau tandai Rejected.
        </p>
      )}

      <div className={`grid gap-4 items-start ${doc ? 'xl:grid-cols-[minmax(0,1fr)_320px]' : ''}`}>
        <div className="space-y-4 min-w-0">
          <section className="rounded-lg border border-line bg-surface p-4">
            <fieldset disabled={!editable || busy} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <FormField label="Customer" htmlFor="q-customer" required>
                <select id="q-customer" value={form.customer} onChange={(e) => changeCustomer(e.target.value)} className={inputClass}>
                  <option value="">— choose —</option>
                  {customerOptions.map((c) => (
                    <option key={c._id} value={c._id}>{c.isWalkIn ? `${c.name} (calon pembeli)` : c.name}{c.isActive === false ? ' (inactive)' : ''}</option>
                  ))}
                </select>
              </FormField>
              {walkIn && (
                <>
                  <FormField label="Prospect name" htmlFor="q-prospect" required>
                    <input id="q-prospect" value={form.prospectName} maxLength={120}
                      onChange={(e) => setForm((f) => ({ ...f, prospectName: e.target.value }))} className={inputClass} />
                  </FormField>
                  <FormField label="Prospect contact" htmlFor="q-contact">
                    <input id="q-contact" value={form.prospectContact} maxLength={120} placeholder="Telp. / email"
                      onChange={(e) => setForm((f) => ({ ...f, prospectContact: e.target.value }))} className={inputClass} />
                  </FormField>
                </>
              )}
              <FormField label="Warehouse" htmlFor="q-gudang" required hint="Sumber barang bila menjadi Sales Order">
                <select id="q-gudang" value={form.gudang} onChange={(e) => setForm((f) => ({ ...f, gudang: e.target.value }))} className={inputClass}>
                  <option value="">— choose —</option>
                  {gudangOptions.map((g) => <option key={g._id} value={g._id}>{g.code} — {g.name}</option>)}
                </select>
              </FormField>
              <FormField label="Date" htmlFor="q-date" required>
                <input id="q-date" type="date" max={toDateInput()} value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className={inputClass} />
              </FormField>
              <FormField label="Valid until" htmlFor="q-valid" required>
                <input id="q-valid" type="date" min={form.date} value={form.validUntil}
                  onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))} className={inputClass} />
              </FormField>
              <FormField label="Delivery" htmlFor="q-method">
                <div id="q-method" className="flex gap-2">
                  {Object.entries(DELIVERY_METHODS).map(([k, m]) => (
                    <label key={k} className={`flex-1 flex items-center gap-2 px-3 py-2 rounded border text-sm cursor-pointer ${form.deliveryMethod === k ? 'border-primary bg-primary-soft text-primary-soft-fg' : 'border-line'}`}>
                      <input type="radio" name="q-method" value={k} checked={form.deliveryMethod === k}
                        onChange={() => setForm((f) => ({ ...f, deliveryMethod: k }))} className="accent-primary" />
                      <i className={`fa ${m.icon}`}></i>{m.label}
                    </label>
                  ))}
                </div>
              </FormField>
              <div className="sm:col-span-2">
                <FormField label="Note" htmlFor="q-note">
                  <input id="q-note" value={form.note} placeholder="Optional" onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className={inputClass} />
                </FormField>
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <FormField label="Terms" htmlFor="q-terms" hint="Syarat penawaran, dicetak di bawah dokumen (mis. harga belum termasuk instalasi, pembayaran 50% di muka).">
                  <textarea id="q-terms" rows={2} maxLength={2000} value={form.terms}
                    onChange={(e) => setForm((f) => ({ ...f, terms: e.target.value }))} className={inputClass} />
                </FormField>
              </div>
            </fieldset>
          </section>

          <section className="rounded-lg border border-line bg-surface">
            <div className="px-4 py-3 border-b border-line">
              <h3 className="font-semibold text-fg">Items ({lines.length})</h3>
              <p className="text-xs text-muted">Harga dari price list customer / harga jual SKU (tidak bisa diubah; potongan lewat diskon). Dikunci saat dikirim.</p>
            </div>
            {editable && (
              <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-line-soft bg-subtle">
                {form.gudang
                  ? <SkuPicker token={user.token} gudang={form.gudang} existing={existing} onAdd={addLines} searchFn={searchFn} />
                  : <span className="text-sm text-muted">Pilih gudang dulu untuk menambah SKU.</span>}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: 860 }}>
                <thead className="bg-head text-head-fg text-left">
                  <tr>
                    <th className="px-2 py-2 border-b border-line font-semibold w-10 text-right">#</th>
                    <th className="px-2 py-2 border-b border-line font-semibold">SKU</th>
                    {editable && <th className="px-2 py-2 border-b border-line font-semibold w-28 text-right" title="Stok − dipesan SO (informasi)">Available</th>}
                    <th className="px-2 py-2 border-b border-line font-semibold w-24 text-right">Qty</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-32 text-right">Price</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-20 text-right">Disc %</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-32 text-right">Subtotal</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-44">Note</th>
                    {editable && <th className="px-2 py-2 border-b border-line w-10"></th>}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, index) => (
                    <tr key={l.sku._id || index} className="align-top hover:bg-subtle">
                      <td className="px-2 py-1.5 border-t border-line-soft text-right text-muted tabular-nums">{index + 1}</td>
                      <td className="px-2 py-1.5 border-t border-line-soft">
                        <div className="font-mono text-xs font-semibold text-fg">
                          {l.sku.sku}
                          {!l.sku.isActive && <span className="ml-1.5 font-sans text-[10px] px-1 rounded bg-subtle text-muted">inactive</span>}
                        </div>
                        <div className="text-xs text-muted truncate max-w-64">{l.sku.produkName} · {l.sku.variant}</div>
                      </td>
                      {editable && (
                        <td className={`px-2 py-1.5 border-t border-line-soft text-right tabular-nums ${hasValue(l.available) && Number(l.qty) > l.available ? 'text-warning-fg font-semibold' : 'text-muted'}`}>
                          {hasValue(l.available) ? `${formatNumber(l.available)} ${l.sku.uom}` : '-'}
                        </td>
                      )}
                      <td className="px-2 py-1.5 border-t border-line-soft text-right">
                        {editable ? (
                          <input aria-label={`Qty ${l.sku.sku}`} type="number" min="0.01" step="0.01" value={l.qty} disabled={busy}
                            onChange={(e) => setLine(l.sku._id, 'qty', e.target.value)} className={`${cellInput} text-right tabular-nums`} />
                        ) : <span className="tabular-nums">{formatNumber(l.qty)} {l.sku.uom}</span>}
                      </td>
                      <td className="px-2 py-1.5 border-t border-line-soft text-right">
                        <span className={`tabular-nums ${editable ? 'inline-block py-1' : ''}`}>{formatRupiah(l.hargaJual)}</span>
                        {editable && l.priceSource === 'list' && <div className="text-[10px] text-primary mt-0.5">price list</div>}
                      </td>
                      <td className="px-2 py-1.5 border-t border-line-soft text-right">
                        {editable ? (
                          <input aria-label={`Discount ${l.sku.sku}`} type="number" min="0" max="100" step="0.01" value={l.diskonPersen} disabled={busy}
                            onChange={(e) => setLine(l.sku._id, 'diskonPersen', e.target.value)} className={`${cellInput} text-right tabular-nums`} />
                        ) : <span className="tabular-nums">{l.diskonPersen ? formatNumber(l.diskonPersen) : '-'}</span>}
                      </td>
                      <td className="px-2 py-1.5 border-t border-line-soft text-right tabular-nums font-medium">{formatRupiah(salesLineSubtotal(l))}</td>
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
                  ))}
                  {lines.length === 0 && (
                    <tr><td colSpan={9} className="text-center py-8 text-muted">Belum ada SKU.{editable && ' Cari SKU di atas.'}</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap justify-end gap-6 px-4 py-3 border-t border-line text-sm">
              <fieldset disabled={!editable || busy} className="space-y-2 min-w-56">
                <label className="flex items-center justify-between gap-3">
                  <span className="text-muted">Document discount (Rp)</span>
                  <input aria-label="Document discount" type="number" min="0" step="0.01" value={form.discountAmount}
                    onChange={(e) => setForm((f) => ({ ...f, discountAmount: e.target.value }))} className={`${cellInput} w-36 text-right tabular-nums`} />
                </label>
                {delivery && (
                  <label className="flex items-center justify-between gap-3">
                    <span className="text-muted">Shipping charge (Rp)</span>
                    <input aria-label="Shipping charge" type="number" min="0" step="0.01" value={form.shippingCharge}
                      onChange={(e) => setForm((f) => ({ ...f, shippingCharge: e.target.value }))} className={`${cellInput} w-36 text-right tabular-nums`} />
                  </label>
                )}
                <label className="flex items-center justify-between gap-3">
                  <span className="text-muted">PPN (%)</span>
                  <input aria-label="Tax rate" type="number" min="0" max="100" step="0.01" value={form.taxRate}
                    onChange={(e) => setForm((f) => ({ ...f, taxRate: e.target.value }))} className={`${cellInput} w-36 text-right tabular-nums`} />
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
                <dt className="text-muted">DPP</dt><dd className="text-right tabular-nums">{formatRupiah(totals.dpp)}</dd>
                {totals.shippingCharge > 0 && (<><dt className="text-muted">Shipping</dt><dd className="text-right tabular-nums">{formatRupiah(totals.shippingDpp)}</dd></>)}
                <dt className="text-muted">PPN {formatNumber(Number(form.taxRate) || 0)}%{form.priceIncludesTax ? ' (incl.)' : ''}</dt>
                <dd className="text-right tabular-nums">{formatRupiah(totals.taxAmount)}</dd>
                <dt className="font-semibold">Total</dt><dd className="text-right tabular-nums font-semibold">{formatRupiah(totals.total)}</dd>
              </dl>
            </div>
          </section>
        </div>

        {doc && (
          <aside className="space-y-4 min-w-0">
            <section className="rounded-lg border border-line bg-surface p-4 text-sm">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                <dt className="text-muted">Status</dt><dd><StatusBadge status={viewStatus} meta={QUOTATION_STATUS_META} /></dd>
                <dt className="text-muted">To</dt>
                <dd className="break-words">
                  {doc.customer?.isWalkIn ? (doc.prospectName || '-') : (doc.customer?.name || '-')}
                  {doc.customer?.isWalkIn && doc.prospectContact && <div className="text-xs text-muted">{doc.prospectContact}</div>}
                  {!doc.customer?.isWalkIn && doc.customer?.phone && <div className="text-xs text-muted">{doc.customer.phone}</div>}
                </dd>
                <dt className="text-muted">Valid until</dt><dd className={doc.expired ? 'text-danger' : ''}>{formatDay(doc.validUntil)}</dd>
                {doc.sentDate && (<><dt className="text-muted">Sent</dt><dd>{formatDate2(doc.sentDate)} · {doc.sentBy?.name || '-'}</dd></>)}
                {doc.salesOrder && (
                  <>
                    <dt className="text-muted">Sales order</dt>
                    <dd>
                      {soPerm.canView
                        ? <Link to={`/sales-order/${doc.salesOrder._id}`} className="font-mono text-xs font-semibold text-primary hover:underline">{doc.salesOrder.no}</Link>
                        : <span className="font-mono text-xs">{doc.salesOrder.no}</span>}
                      <span className="ml-1.5"><StatusBadge status={doc.salesOrder.status} meta={SO_STATUS_META} /></span>
                    </dd>
                  </>
                )}
                {doc.acceptedDate && (<><dt className="text-muted">Accepted</dt><dd>{formatDate2(doc.acceptedDate)} · {doc.acceptedBy?.name || '-'}</dd></>)}
                {doc.rejectedDate && (<><dt className="text-muted">Rejected</dt><dd>{formatDate2(doc.rejectedDate)} · {doc.rejectedBy?.name || '-'}</dd></>)}
                {doc.rejectReason && (<><dt className="text-muted">Reason</dt><dd className="break-words">{doc.rejectReason}</dd></>)}
              </dl>
              <div className="mt-3"><AuditDetail data={doc} /></div>
            </section>
            <section className="rounded-lg border border-line bg-surface p-4">
              <h3 className="font-semibold text-fg mb-2">History</h3>
              <AuditTimeline entity="quotation" id={doc._id} refreshKey={version} />
            </section>
          </aside>
        )}
      </div>
    </div>
  );
}
