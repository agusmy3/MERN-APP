import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  getSalesOrder,
  createSalesOrder,
  updateSalesOrder,
  deleteSalesOrder,
  confirmSalesOrder,
  cancelSalesOrder,
  closeSalesOrder,
  searchSoSkus,
  getSoSkuAvailability,
  getSoSkuPrices,
  getSoCustomerShipTo,
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
import CreditSummary from '../components/sales/CreditSummary';
import { printSalesOrder } from '../utils/documentPrint';
import AuditTimeline from '../components/audit/AuditTimeline';
import { AuditDetail } from '../components/AuditInfo';
import UnitCell from '../components/sales/UnitCell';
import { unitFieldsFromDoc, unitFieldsFromSearch, nextUnitFor, withUnit, payloadUnit, priceItems, priceKey, baseQty } from '../utils/salesLines';
import { inputClass } from '../utils/formStyles';
import RegionFields from '../components/RegionFields';
import { EMPTY_REGION } from '../utils/regionMeta';
import { formatNumber, formatRupiah, round2, variantLabel } from '../utils/formatHelper';
import { formatDate2, formatDay, toDateInput } from '../utils/dateHelper';
import {
  SO_STATUS_META, DO_STATUS_META, INVOICE_STATUS_META, PAYMENT_STATUS_META, DELIVERY_METHODS,
  salesLineSubtotal, salesTotals, addressLine,
} from '../utils/salesMeta';

const cellInput = `w-full bg-input text-fg border border-line rounded px-2 py-1 text-sm
  focus:outline-none focus:border-primary disabled:bg-transparent disabled:border-transparent`;
const btn = 'px-4 py-2 rounded text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
const btnGhost = `${btn} border border-line hover:bg-subtle`;
const btnPrimary = `${btn} bg-primary hover:bg-primary-hover text-primary-fg`;
const btnDanger = `${btn} border border-danger-line text-danger hover:bg-danger-soft`;

const isBlank = (v) => v === '' || v === null || v === undefined;
const hasValue = (v) => v !== null && v !== undefined;
const EMPTY_SHIP = { name: '', phone: '', alamat: '', ...EMPTY_REGION };
const shipFrom = (s) => Object.fromEntries(Object.keys(EMPTY_SHIP).map((k) => [k, s?.[k] ?? '']));

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
  ...unitFieldsFromDoc(l),
  currentQty: l.currentQty ?? null,
  committed: l.committed ?? null,
  available: l.available ?? null,
  unitCost: l.unitCost ?? null,
  qtyDelivered: l.qtyDelivered || 0,
});

const lineFromSearch = (s, unit) => ({
  sku: { _id: s._id, sku: s.sku, produkName: s.produk?.name || '', variant: s.variant, uom: s.uom, isActive: s.isActive },
  qty: 1,
  hargaJual: s.hargaJual ?? '',
  diskonPersen: 0,
  note: '',
  currentQty: s.qty,
  committed: s.committed ?? 0,
  available: s.available ?? s.qty,
  unitCost: s.avgCost ?? null,
  priceSource: s.priceSource || 'default',
  qtyDelivered: 0,
  ...unitFieldsFromSearch(s, unit),
});

const toPayload = (form, lines) => ({
  customer: form.customer,
  gudang: form.gudang,
  date: form.date,
  requestedDate: form.requestedDate || null,
  customerPoNo: form.customerPoNo,
  deliveryMethod: form.deliveryMethod,
  shipTo: form.deliveryMethod === 'DELIVERY' ? form.shipTo : undefined,
  note: form.note,
  taxRate: form.taxRate,
  priceIncludesTax: form.priceIncludesTax,
  discountAmount: form.discountAmount || 0,
  shippingCharge: form.deliveryMethod === 'DELIVERY' ? (form.shippingCharge || 0) : 0,
  // harga tidak dikirim: backend mengisinya dari price list / harga jual SKU (dibekukan)
  lines: lines.map((l) => ({ sku: l.sku._id, uom: payloadUnit(l), qty: l.qty, diskonPersen: l.diskonPersen || 0, note: l.note })),
});

/**
 * Sales Order: /sales-order/:id (id = 'new')
 *   Draft   : customer (bukan walk-in), gudang, dikirim / diambil sendiri, alamat kirim (default alamat customer),
 *             baris SKU (harga dibekukan, diskon baris & dokumen), ongkir, PPN. Tidak mengubah stok.
 *   Confirm : OPEN -> dikirim bertahap lewat Delivery Order (stok keluar), lalu ditagih per surat jalan.
 *   Cancel (OPEN, belum ada kiriman) / Close (PARTIAL, sisa tidak dikirim), alasan wajib.
 */
export default function SalesOrderDetail() {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const { user } = useAuth();
  const perm = usePermission('salesOrder');
  const dlvPerm = usePermission('deliveryOrder');
  const invPerm = usePermission('salesInvoice');
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
  const [panel, setPanel] = useState(null); // 'cancel' | 'close'
  const [credit, setCredit] = useState(null);           // posisi kredit customer (tanpa SO ini)
  const [creditBlock, setCreditBlock] = useState(null); // rincian 409 CREDIT_BLOCK saat konfirmasi
  const [blockOverdue, setBlockOverdue] = useState(true);

  useEffect(() => {
    getSettings(user.token).then(({ values }) => setBlockOverdue(values['sales.blockOverdue'] !== false)).catch(console.error);
  }, [user.token]);

  useEffect(() => {
    getGudangDropdown(user.token).then(setGudangList).catch(console.error);
    getCustomerDropdown(user.token).then((list) => setCustomerList(list.filter((c) => !c.isWalkIn))).catch(console.error);
  }, [user.token]);

  const applyDoc = useCallback((d) => {
    const f = {
      customer: d.customer?._id || '',
      gudang: d.gudang?._id || '',
      date: toDateInput(d.date),
      requestedDate: d.requestedDate ? toDateInput(d.requestedDate) : '',
      customerPoNo: d.customerPoNo || '',
      deliveryMethod: d.deliveryMethod || 'DELIVERY',
      shipTo: shipFrom(d.shipTo),
      note: d.note || '',
      taxRate: d.taxRate ?? 0,
      priceIncludesTax: !!d.priceIncludesTax,
      discountAmount: d.discountAmount || 0,
      shippingCharge: d.shippingCharge || 0,
    };
    const ls = d.lines.map(lineFromDoc);
    setDoc(d);
    setCredit(d.credit || null);
    setCreditBlock(null);
    setForm(f);
    setLines(ls);
    setSavedPayload(JSON.stringify(toPayload(f, ls)));
  }, []);

  const load = useCallback(async () => {
    try {
      applyDoc(await getSalesOrder(id, user.token));
      setVersion((v) => v + 1);
    } catch (err) {
      const s = err.response?.status;
      if ([400, 403, 404].includes(s)) setNotFound(s === 403 ? err.response?.data?.message : 'Sales order mungkin sudah dihapus.');
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
    setCredit(null);
    setCreditBlock(null);
    setForm({
      customer: '', gudang: '', date: toDateInput(), requestedDate: '', customerPoNo: '', deliveryMethod: 'DELIVERY',
      shipTo: { ...EMPTY_SHIP }, note: '', taxRate: 0, priceIncludesTax: false, discountAmount: 0, shippingCharge: 0,
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

  const status = isNew ? 'DRAFT' : doc?.status;
  const isDraft = status === 'DRAFT';
  const isActive = status === 'OPEN' || status === 'PARTIAL';
  const editable = isNew ? perm.canCreate : isDraft && perm.canUpdate;
  const payload = form ? toPayload(form, lines) : null;
  const dirty = editable && (isNew ? lines.length > 0 : JSON.stringify(payload) !== savedPayload);
  const showStock = isDraft || isActive;

  // ---------- baris ----------
  const existing = useMemo(() => new Set(lines.map((l) => l.sku._id)), [lines]);
  const addLines = (skus) => {
    const next = [...lines];
    let added = 0;
    skus.forEach((s) => {
      const unit = nextUnitFor(s, next); // SKU sama boleh beberapa satuan (DUS + PCS)
      if (unit) {
        next.push(lineFromSearch(s, unit));
        added += 1;
      }
    });
    if (!added) return toast.info('Semua satuan SKU tersebut sudah ada di dokumen.');
    setLines(next);
  };
  const setLine = (key, field, value) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, [field]: value } : l)));
  const setUnit = (key, uomId) => setLines((prev) => prev.map((l) => (l.key === key ? withUnit(l, uomId) : l)));
  const removeLine = (key) => setLines((prev) => prev.filter((l) => l.key !== key));

  const searchFn = useCallback(
    (token, params) => searchSoSkus(token, { ...params, customer: form?.customer || undefined, exclude: isNew ? undefined : id }),
    [form?.customer, isNew, id],
  );

  const setShip = (k, v) => setForm((f) => ({ ...f, shipTo: { ...f.shipTo, [k]: v } }));

  // ganti customer: alamat kirim default + harga baris mengikuti price list customer baru
  const changeCustomer = async (customer) => {
    setForm((f) => ({ ...f, customer }));
    setCreditBlock(null);
    if (!customer) {
      setCredit(null);
      return;
    }
    try {
      const { shipTo, credit: c } = await getSoCustomerShipTo(customer, user.token, isNew ? undefined : id);
      setForm((f) => ({ ...f, shipTo: shipFrom(shipTo) }));
      setCredit(c || null);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load customer address');
    }
    if (!lines.length) return;
    try {
      const prices = await getSoSkuPrices(user.token, customer, priceItems(lines));
      let changed = 0;
      setLines((prev) => prev.map((l) => {
        const p = prices[priceKey(l)];
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
      const av = await getSoSkuAvailability(user.token, gudang, lines.map((l) => l.sku._id), isNew ? undefined : id);
      setLines((prev) => prev.map((l) => ({ ...l, currentQty: av[l.sku._id]?.qty ?? 0, committed: av[l.sku._id]?.committed ?? 0, available: av[l.sku._id]?.available ?? 0 })));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load stock');
    }
  };

  const totals = useMemo(() => (form ? salesTotals(lines, {
    ...form, shippingCharge: form.deliveryMethod === 'DELIVERY' ? form.shippingCharge : 0,
  }) : null), [lines, form]);
  const summary = useMemo(() => {
    let short = 0;
    let cost = 0;
    let costMissing = false;
    for (const l of lines) {
      const q = baseQty(l);
      const remaining = q - (l.qtyDelivered || 0);
      if (showStock && hasValue(l.available) && remaining > l.available) short++;
      if (hasValue(l.unitCost)) cost += q * l.unitCost;
      else if (q > 0) costMissing = true;
    }
    return { short, cost: round2(cost), costMissing };
  }, [lines, showStock]);
  const ratio = totals && totals.subtotal ? totals.dpp / totals.subtotal : 0;
  const grossProfit = totals ? round2(totals.dpp - summary.cost) : 0;

  // ---------- aksi ----------
  const validate = () => {
    if (!form.customer) return 'Pilih customer.';
    if (!form.gudang) return 'Pilih gudang.';
    if (form.deliveryMethod === 'DELIVERY' && !form.shipTo.alamat.trim()) return 'Isi alamat kirim.';
    if (form.shipTo.kodePos && !/^\d{5}$/.test(form.shipTo.kodePos)) return 'Kode pos 5 digit.';
    if (!lines.length) return 'Tambahkan minimal 1 SKU.';
    const bad = lines.find((l) => isBlank(l.qty) || Number(l.qty) <= 0);
    if (bad) return `${bad.sku.sku}: isi qty (> 0).`;
    const frac = lines.find((l) => (l.konversi || 1) > 1 && !Number.isInteger(Number(l.qty)));
    if (frac) return `${frac.sku.sku}: qty ${frac.uomCode} harus bilangan bulat.`;
    const disc = lines.find((l) => Number(l.diskonPersen) < 0 || Number(l.diskonPersen) > 100);
    if (disc) return `${disc.sku.sku}: diskon 0 – 100%.`;
    if (Number(form.discountAmount) > totals.subtotal) return 'Diskon dokumen tidak boleh melebihi subtotal.';
    return null;
  };

  // 409 CREDIT_BLOCK: tampilkan panel persetujuan (atau info jika tidak berhak menyetujui)
  const handleCreditBlock = (err) => {
    const data = err.response?.data;
    if (err.response?.status !== 409 || data?.data?.code !== 'CREDIT_BLOCK') return false;
    setCreditBlock(data.data);
    setCredit(data.data.credit);
    setPanel(null);
    if (data.data.canApprove) toast.warning('Pemeriksaan kredit gagal: isi alasan persetujuan untuk tetap mengonfirmasi.');
    else toast.error(data.message);
    return true;
  };

  const save = async ({ confirmIt = false, override = null } = {}) => {
    const error = validate();
    if (error) {
      toast.warning(error);
      return;
    }
    setBusy(true);
    try {
      const body = { ...payload, confirm: confirmIt, ...(override ? { creditOverride: { reason: override } } : {}) };
      const res = isNew ? await createSalesOrder(body, user.token) : await updateSalesOrder(id, body, user.token);
      toast.success(res.data.message);
      setCreditBlock(null);
      if (isNew) navigate(`/sales-order/${res.data.data._id}`, { replace: true });
      else await load();
    } catch (err) {
      if (!handleCreditBlock(err)) toast.error(err.response?.data?.message || 'Failed to save sales order');
    } finally {
      setBusy(false);
    }
  };

  const doConfirm = async (override = null) => {
    if (dirty || isNew) return save({ confirmIt: true, override });
    setBusy(true);
    try {
      const res = await confirmSalesOrder(id, user.token, override ? { creditOverride: { reason: override } } : {});
      toast.success(res.data.message);
      setCreditBlock(null);
      await load();
    } catch (err) {
      if (!handleCreditBlock(err)) toast.error(err.response?.data?.message || 'Failed to confirm sales order');
    } finally {
      setBusy(false);
    }
  };

  const confirmOrder = async () => {
    const error = dirty || isNew ? validate() : null;
    if (error) return toast.warning(error);
    const ok = await confirm({
      title: `Confirm ${doc?.no || 'sales order'}?`,
      message: `Pesanan ${formatRupiah(totals.total)} dikonfirmasi dan siap dikirim lewat surat jalan. `
        + `Setelah dikonfirmasi isi SO tidak bisa diubah (hanya dibatalkan / ditutup).`
        + (summary.short ? ` ${summary.short} SKU melebihi stok tersedia saat ini.` : ''),
      confirmLabel: dirty || isNew ? 'Save & Confirm' : 'Confirm',
    });
    if (!ok) return;
    return doConfirm();
  };

  const removeDraft = async () => {
    const ok = await confirm({ title: `Delete ${doc.no}?`, message: 'Draft ini akan dihapus permanen.', confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
    try {
      const res = await deleteSalesOrder(id, user.token);
      toast.success(res.data.message);
      navigate('/sales-order');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete sales order');
    }
  };

  const runPanel = async (reason) => {
    setBusy(true);
    try {
      const fn = panel === 'close' ? closeSalesOrder : cancelSalesOrder;
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


  // cetak dengan kop perusahaan (System Settings company.*)
  const printDoc = async () => {
    let company = {};
    try {
      company = (await getSettings(user.token)).values;
    } catch (err) {
      console.error(err);
    }
    printSalesOrder(doc, company);
  };

  // ---------- render ----------
  if (notFound) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <p className="text-xl font-semibold text-fg mb-1">Sales order not available</p>
        <p className="text-muted mb-6">{notFound}</p>
        <Link to="/sales-order" className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded">
          <i className="fa fa-arrow-left"></i> Back to Sales Order
        </Link>
      </div>
    );
  }
  if (!form) return <div className="p-6 text-muted">Loading...</div>;
  if (isNew && perm.loaded && !perm.canCreate) {
    return <div className="p-6 text-muted">You don&apos;t have permission to create sales orders.</div>;
  }

  const colSpan = 8 + (showStock ? 2 : 0) + (!isDraft ? 1 : 0) + (canSeeCost ? 2 : 0) + (editable ? 1 : 0);
  const customer = customerList.find((c) => c._id === form.customer) || doc?.customer;
  const delivery = form.deliveryMethod === 'DELIVERY';

  return (
    <div className="h-full p-4 flex flex-col overflow-auto">
      <PageHeader
        fallbackTitle="Sales Order"
        parentPath="/sales-order"
        title={doc?.no || 'New Sales Order'}
        subtitle="Pesanan customer: stok keluar saat surat jalan (Delivery Order) diposting."
        actions={(
          <>
            {!isNew && <StatusBadge status={status} meta={SO_STATUS_META} />}
            {doc && (
              <button type="button" onClick={printDoc} disabled={busy} className={btnGhost} title="Cetak konfirmasi pesanan (dengan harga)">
                <i className="fa fa-print"></i> Print
              </button>
            )}
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
            {isDraft && (isNew ? perm.canCreate : perm.canUpdate) && (
              <button type="button" onClick={confirmOrder} disabled={busy || !lines.length} className={btnPrimary}>
                <i className="fa fa-check"></i> {dirty || isNew ? 'Save & Confirm' : 'Confirm'}
              </button>
            )}
            {isActive && dlvPerm.canCreate && (
              <button type="button" onClick={() => navigate(`/delivery-order/new?so=${doc._id}`)} disabled={busy} className={btnPrimary}>
                <i className="fa fa-truck-fast"></i> {delivery ? 'Kirim' : 'Serahkan'} (Delivery Order)
              </button>
            )}
            {status === 'PARTIAL' && perm.canUpdate && (
              <button type="button" onClick={() => setPanel((p) => (p === 'close' ? null : 'close'))} disabled={busy} className={btnGhost}>
                <i className="fa fa-lock"></i> Close
              </button>
            )}
            {status === 'OPEN' && perm.canUpdate && (
              <button type="button" onClick={() => setPanel((p) => (p === 'cancel' ? null : 'cancel'))} disabled={busy} className={btnDanger}>
                <i className="fa fa-ban"></i> Cancel SO
              </button>
            )}
          </>
        )}
      />

      {panel && (
        <ReasonPanel
          title={panel === 'close' ? `Close ${doc.no}` : `Cancel ${doc.no}`}
          description={panel === 'close'
            ? 'Sisa pesanan yang belum dikirim tidak akan dikirim. Surat jalan & invoice yang sudah ada tidak berubah.'
            : 'Pesanan dibatalkan sebelum ada barang yang dikirim.'}
          placeholder="Alasan (wajib)"
          confirmLabel={panel === 'close' ? 'Close SO' : 'Cancel SO'}
          busy={busy}
          onConfirm={runPanel}
          onClose={() => setPanel(null)}
        />
      )}

      {creditBlock && isDraft && (creditBlock.canApprove ? (
        <ReasonPanel
          title="Approve credit exception"
          description={`Pemeriksaan kredit gagal: ${creditBlock.issues.join('; ')}. Konfirmasi tetap bisa dilakukan dengan alasan (tercatat di audit).`}
          placeholder="Alasan persetujuan (wajib)"
          confirmLabel={dirty || isNew ? 'Approve, Save & Confirm' : 'Approve & Confirm'}
          icon="fa-check"
          busy={busy}
          onConfirm={(reason) => doConfirm(reason)}
          onClose={() => setCreditBlock(null)}
        />
      ) : (
        <div className="mb-4 rounded-lg border border-danger-line bg-danger-soft p-4 text-sm max-w-3xl">
          <p className="font-semibold text-danger mb-1"><i className="fa fa-ban mr-1.5"></i>Credit check failed</p>
          <p className="text-fg">{creditBlock.issues.join('; ')}.</p>
          <p className="text-muted mt-1">Simpan sebagai draft, lalu minta user dengan izin <b>Sales Order: Approve</b> untuk mengonfirmasi.</p>
        </div>
      ))}

      {isDraft && credit && (credit.limit > 0 || credit.overdue?.count > 0) && (
        <CreditSummary credit={credit} orderTotal={totals?.total ?? 0} blockOverdue={blockOverdue} className="mb-4 max-w-md" />
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
              <FormField label="Customer" htmlFor="so-customer" required>
                <select id="so-customer" value={form.customer} onChange={(e) => changeCustomer(e.target.value)} className={inputClass}>
                  <option value="">— choose —</option>
                  {customerOptions.map((c) => (
                    <option key={c._id} value={c._id}>{c.name}{c.isActive === false ? ' (inactive)' : ''}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Warehouse" htmlFor="so-gudang" required>
                <select id="so-gudang" value={form.gudang} onChange={(e) => changeGudang(e.target.value)} className={inputClass}>
                  <option value="">— choose —</option>
                  {(editable ? gudangOptions : gudangList.filter((g) => g._id === form.gudang)).map((g) => (
                    <option key={g._id} value={g._id}>{g.code} — {g.name}{g.isActive === false ? ' (inactive)' : ''}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Order date" htmlFor="so-date" required>
                <input id="so-date" type="date" max={toDateInput()} value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className={inputClass} />
              </FormField>
              <FormField label="Requested delivery" htmlFor="so-req" hint="Tanggal kirim yang diminta customer">
                <input id="so-req" type="date" min={form.date} value={form.requestedDate}
                  onChange={(e) => setForm((f) => ({ ...f, requestedDate: e.target.value }))} className={inputClass} />
              </FormField>
              <FormField label="Customer PO No." htmlFor="so-cpo">
                <input id="so-cpo" value={form.customerPoNo} maxLength={100} placeholder="Optional"
                  onChange={(e) => setForm((f) => ({ ...f, customerPoNo: e.target.value }))} className={inputClass} />
              </FormField>
              <FormField label="Delivery method" htmlFor="so-method">
                <div id="so-method" role="radiogroup" className="flex gap-2">
                  {Object.entries(DELIVERY_METHODS).map(([k, m]) => (
                    <label key={k} className={`flex-1 flex items-center gap-2 px-3 py-2 rounded border text-sm cursor-pointer ${form.deliveryMethod === k ? 'border-primary bg-primary-soft text-primary-soft-fg' : 'border-line'}`}>
                      <input type="radio" name="so-method" value={k} checked={form.deliveryMethod === k}
                        onChange={() => setForm((f) => ({ ...f, deliveryMethod: k }))} className="accent-primary" />
                      <i className={`fa ${m.icon}`}></i>{m.label}
                    </label>
                  ))}
                </div>
              </FormField>
              <div className="sm:col-span-2">
                <FormField label="Note" htmlFor="so-note">
                  <input id="so-note" value={form.note} placeholder="Optional"
                    onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className={inputClass} />
                </FormField>
              </div>
            </fieldset>
          </section>

          {delivery && (
            <section className="rounded-lg border border-line bg-surface p-4">
              <h3 className="font-semibold text-fg">Ship to</h3>
              <p className="text-xs text-muted mb-3">Default dari alamat customer; bisa diganti untuk SO ini saja.</p>
              <fieldset disabled={!editable || busy} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <FormField label="Recipient" htmlFor="ship-name">
                  <input id="ship-name" value={form.shipTo.name} maxLength={120} onChange={(e) => setShip('name', e.target.value)} className={inputClass} />
                </FormField>
                <FormField label="Phone" htmlFor="ship-phone">
                  <input id="ship-phone" value={form.shipTo.phone} maxLength={40} onChange={(e) => setShip('phone', e.target.value)} className={inputClass} />
                </FormField>
                <div className="sm:col-span-2">
                  <FormField label="Address" htmlFor="ship-alamat" required>
                    <input id="ship-alamat" value={form.shipTo.alamat} maxLength={500} onChange={(e) => setShip('alamat', e.target.value)} className={inputClass} />
                  </FormField>
                </div>
                <div className="sm:col-span-2 lg:col-span-4 grid gap-4">
                  <RegionFields form={form.shipTo} idPrefix="ship" showCoordinates={false}
                    setForm={(update) => setForm((f) => ({ ...f, shipTo: typeof update === 'function' ? update(f.shipTo) : update }))} />
                </div>
              </fieldset>
            </section>
          )}

          <section className="rounded-lg border border-line bg-surface">
            <div className="px-4 py-3 border-b border-line">
              <h3 className="font-semibold text-fg">Items ({lines.length})</h3>
              <p className="text-xs text-muted">
                Qty & harga per satuan dasar. Harga dari price list customer / harga jual SKU dan tidak bisa diubah; potongan lewat diskon.
                {showStock && ' Available = stok gudang − dipesan SO lain yang belum dikirim (informasi, tidak mengunci stok).'}
              </p>
            </div>

            {editable && (
              <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-line-soft bg-subtle">
                {form.gudang
                  ? <SkuPicker token={user.token} gudang={form.gudang} existing={existing} onAdd={addLines} searchFn={searchFn} />
                  : <span className="text-sm text-muted">Pilih gudang dulu untuk menambah SKU.</span>}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: canSeeCost ? 1180 : 980 }}>
                <thead className="bg-head text-head-fg text-left">
                  <tr>
                    <th className="px-2 py-2 border-b border-line font-semibold w-10 text-right">#</th>
                    <th className="px-2 py-2 border-b border-line font-semibold">SKU</th>
                    {showStock && (
                      <>
                        <th className="px-2 py-2 border-b border-line font-semibold w-24 text-right" title="Saldo saat ini di gudang">Stock</th>
                        <th className="px-2 py-2 border-b border-line font-semibold w-28 text-right" title="Stok − dipesan SO lain (OPEN / PARTIAL)">Available</th>
                      </>
                    )}
                    <th className="px-2 py-2 border-b border-line font-semibold w-24 text-right">Qty</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-28">Unit</th>
                    {!isDraft && <th className="px-2 py-2 border-b border-line font-semibold w-24 text-right">Delivered</th>}
                    <th className="px-2 py-2 border-b border-line font-semibold w-32 text-right">Price</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-20 text-right">Disc %</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-32 text-right">Subtotal</th>
                    {canSeeCost && (
                      <>
                        <th className="px-2 py-2 border-b border-line font-semibold w-28 text-right" title="HPP saat ini (perkiraan)">HPP (est.)</th>
                        <th className="px-2 py-2 border-b border-line font-semibold w-32 text-right" title="Pendapatan bersih - HPP (perkiraan)">Margin</th>
                      </>
                    )}
                    <th className="px-2 py-2 border-b border-line font-semibold w-44">Note</th>
                    {editable && <th className="px-2 py-2 border-b border-line w-10"></th>}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, index) => {
                    const q = baseQty(l);
                    const remaining = q - (l.qtyDelivered || 0);
                    const short = showStock && hasValue(l.available) && remaining > l.available;
                    const sub = salesLineSubtotal(l);
                    const cost = hasValue(l.unitCost) ? round2(q * l.unitCost) : null;
                    const margin = cost === null ? null : round2(sub * ratio - cost);
                    return (
                      <tr key={l.key} className="align-top hover:bg-subtle">
                        <td className="px-2 py-1.5 border-t border-line-soft text-right text-muted tabular-nums">{index + 1}</td>
                        <td className="px-2 py-1.5 border-t border-line-soft">
                          <div className="font-mono text-xs font-semibold text-fg">
                            {l.sku.sku}
                            {!l.sku.isActive && <span className="ml-1.5 font-sans text-[10px] px-1 rounded bg-subtle text-muted">inactive</span>}
                          </div>
                          <div className="text-xs text-muted truncate max-w-64">{l.sku.produkName} · {l.sku.variant}</div>
                        </td>
                        {showStock && (
                          <>
                            <td className="px-2 py-1.5 border-t border-line-soft text-right tabular-nums text-muted">
                              {hasValue(l.currentQty) ? formatNumber(l.currentQty) : '-'}
                            </td>
                            <td className={`px-2 py-1.5 border-t border-line-soft text-right tabular-nums ${short ? 'text-warning-fg font-semibold' : 'text-muted'}`}
                              title={hasValue(l.committed) ? `Dipesan SO lain: ${formatNumber(l.committed)}` : undefined}>
                              {hasValue(l.available) ? `${formatNumber(l.available)} ${l.sku.uom}` : '-'}
                            </td>
                          </>
                        )}
                        <td className="px-2 py-1.5 border-t border-line-soft text-right">
                          {editable ? (
                            <input aria-label={`Qty ${l.sku.sku}`} type="number" min="0.01" step="0.01" value={l.qty} disabled={busy}
                              onChange={(e) => setLine(l.key, 'qty', e.target.value)} className={`${cellInput} text-right tabular-nums`} />
                          ) : <span className="tabular-nums">{formatNumber(l.qty)}</span>}
                        </td>
                        <td className="px-2 py-1.5 border-t border-line-soft">
                          <UnitCell line={l} lines={lines} editable={editable} disabled={busy} onChange={(uomId) => setUnit(l.key, uomId)} />
                        </td>
                        {!isDraft && (
                          <td className={`px-2 py-1.5 border-t border-line-soft text-right tabular-nums ${l.qtyDelivered >= q ? 'text-success-fg' : ''}`}>
                            {formatNumber(round2(l.qtyDelivered / (l.konversi || 1)))}
                          </td>
                        )}
                        <td className="px-2 py-1.5 border-t border-line-soft text-right"
                          title={editable ? 'Harga dari price list customer / harga jual SKU (tidak bisa diubah; pakai kolom diskon)' : undefined}>
                          <span className={`tabular-nums ${editable ? 'inline-block py-1' : ''}`}>{formatRupiah(l.hargaJual)}</span>
                          {editable && l.priceSource === 'list' && <div className="text-[10px] text-primary mt-0.5">price list</div>}
                        </td>
                        <td className="px-2 py-1.5 border-t border-line-soft text-right">
                          {editable ? (
                            <input aria-label={`Discount ${l.sku.sku}`} type="number" min="0" max="100" step="0.01" value={l.diskonPersen} disabled={busy}
                              onChange={(e) => setLine(l.key, 'diskonPersen', e.target.value)} className={`${cellInput} text-right tabular-nums`} />
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
                            onChange={(e) => setLine(l.key, 'note', e.target.value)} className={cellInput} />
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
                    <tr><td colSpan={colSpan} className="text-center py-8 text-muted">Belum ada SKU.{editable && ' Cari SKU di atas.'}</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {summary.short > 0 && (
              <div className="px-4 py-2 border-t border-line text-sm">
                <p className="text-warning-fg">
                  <i className="fa fa-circle-exclamation mr-1"></i>
                  {summary.short} SKU melebihi stok tersedia saat ini. SO tetap bisa {isDraft ? 'dikonfirmasi' : 'berjalan'}; surat jalan ditolak bila stok kurang saat diposting.
                </p>
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
                {delivery && (
                  <label className="flex items-center justify-between gap-3" title="Ditagih penuh di invoice pertama dari SO ini">
                    <span className="text-muted">Shipping charge (Rp)</span>
                    <input aria-label="Shipping charge" type="number" min="0" step="0.01" value={form.shippingCharge}
                      onChange={(e) => setForm((f) => ({ ...f, shippingCharge: e.target.value }))}
                      className={`${cellInput} w-36 text-right tabular-nums`} />
                  </label>
                )}
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
                <dt className="text-muted" title="Dasar pengenaan pajak barang = penjualan bersih">DPP</dt><dd className="text-right tabular-nums">{formatRupiah(totals.dpp)}</dd>
                {totals.shippingCharge > 0 && (
                  <><dt className="text-muted" title="Tanpa PPN; ditagih di invoice pertama">Shipping</dt><dd className="text-right tabular-nums">{formatRupiah(totals.shippingDpp)}</dd></>
                )}
                <dt className="text-muted">PPN {formatNumber(Number(form.taxRate) || 0)}%{form.priceIncludesTax ? ' (incl.)' : ''}</dt>
                <dd className="text-right tabular-nums">{formatRupiah(totals.taxAmount)}</dd>
                <dt className="font-semibold">Total</dt><dd className="text-right tabular-nums font-semibold">{formatRupiah(totals.total)}</dd>
                {canSeeCost && (
                  <>
                    <dt className="text-muted pt-2 border-t border-line-soft">HPP (est.)</dt>
                    <dd className="text-right tabular-nums pt-2 border-t border-line-soft">{formatRupiah(summary.cost)}{summary.costMissing ? '*' : ''}</dd>
                    <dt className="text-muted">Gross profit (est.)</dt>
                    <dd className={`text-right tabular-nums font-medium ${grossProfit < 0 ? 'text-danger' : ''}`}>
                      {formatRupiah(grossProfit)}
                      {totals.dpp > 0 && <span className="text-xs text-muted ml-1">({formatNumber(round2((grossProfit / totals.dpp) * 100))}%)</span>}
                    </dd>
                    {summary.costMissing && <dd className="col-span-2 text-[11px] text-muted">* ada SKU tanpa HPP (dihitung 0)</dd>}
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
                <dt className="text-muted">Status</dt><dd><StatusBadge status={doc.status} meta={SO_STATUS_META} /></dd>
                <dt className="text-muted">Customer</dt>
                <dd className="break-words">
                  {customer?.name || '-'}
                  {doc.customer?.phone && <div className="text-xs text-muted">{doc.customer.phone}</div>}
                  {doc.customer?.npwp && <div className="text-xs text-muted">NPWP {doc.customer.npwp}</div>}
                  {hasValue(doc.customer?.termDays) && <div className="text-xs text-muted">Termin {doc.customer.termDays} hari</div>}
                </dd>
                <dt className="text-muted">Method</dt>
                <dd>
                  <i className={`fa ${DELIVERY_METHODS[doc.deliveryMethod]?.icon} text-muted mr-1.5`}></i>{DELIVERY_METHODS[doc.deliveryMethod]?.label}
                  {doc.deliveryMethod === 'DELIVERY' && <div className="text-xs text-muted break-words">{[doc.shipTo?.name, doc.shipTo?.phone].filter(Boolean).join(' · ')}{doc.shipTo?.name || doc.shipTo?.phone ? <br /> : null}{addressLine(doc.shipTo)}</div>}
                </dd>
                {doc.quotation && (
                  <>
                    <dt className="text-muted">Quotation</dt>
                    <dd><Link to={`/quotation/${doc.quotation._id}`} className="font-mono text-xs font-semibold text-primary hover:underline">{doc.quotation.no}</Link>
                      <div className="text-xs text-muted">Harga mengikuti penawaran</div></dd>
                  </>
                )}
                {doc.requestedDate && (<><dt className="text-muted">Requested</dt><dd>{formatDay(doc.requestedDate)}</dd></>)}
                {doc.confirmedDate && (<><dt className="text-muted">Confirmed</dt><dd>{formatDate2(doc.confirmedDate)} · {doc.confirmedBy?.name || '-'}</dd></>)}
                {doc.creditOverrideDate && (
                  <>
                    <dt className="text-muted">Credit approval</dt>
                    <dd>
                      {formatDate2(doc.creditOverrideDate)} · {doc.creditOverrideBy?.name || '-'}
                      <div className="text-xs text-muted">{doc.creditOverrideNote}</div>
                      <div className="text-xs">“{doc.creditOverrideReason}”</div>
                    </dd>
                  </>
                )}
                {doc.closedDate && (<><dt className="text-muted">Closed</dt><dd>{formatDate2(doc.closedDate)} · {doc.closedBy?.name || '-'}</dd></>)}
                {doc.closeReason && (<><dt className="text-muted">Reason</dt><dd className="break-words">{doc.closeReason}</dd></>)}
                {doc.cancelledDate && (<><dt className="text-muted">Cancelled</dt><dd>{formatDate2(doc.cancelledDate)} · {doc.cancelledBy?.name || '-'}</dd></>)}
                {doc.cancelReason && (<><dt className="text-muted">Reason</dt><dd className="break-words">{doc.cancelReason}</dd></>)}
              </dl>
              {doc.deliveries?.length > 0 && (
                <div className="pt-2 border-t border-line-soft">
                  <div className="text-xs font-semibold text-muted mb-1">Delivery orders</div>
                  <ul className="space-y-1">
                    {doc.deliveries.map((d) => (
                      <li key={d._id} className="flex items-center justify-between gap-2">
                        {dlvPerm.canView
                          ? <Link to={`/delivery-order/${d._id}`} className="font-mono text-xs font-semibold text-primary hover:underline">{d.no}</Link>
                          : <span className="font-mono text-xs">{d.no}</span>}
                        <span className="text-xs text-muted">{formatDay(d.date)}</span>
                        <StatusBadge status={d.status} meta={DO_STATUS_META} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {doc.invoices?.length > 0 && (
                <div className="pt-2 border-t border-line-soft">
                  <div className="text-xs font-semibold text-muted mb-1">Invoices</div>
                  <ul className="space-y-1">
                    {doc.invoices.map((i) => (
                      <li key={i._id} className="flex items-center justify-between gap-2">
                        {invPerm.canView
                          ? <Link to={`/sales-invoice/${i._id}`} className="font-mono text-xs font-semibold text-primary hover:underline">{i.no}</Link>
                          : <span className="font-mono text-xs">{i.no}</span>}
                        <span className="text-xs tabular-nums">{formatRupiah(i.total)}</span>
                        {i.status === 'POSTED' && i.paymentStatus
                          ? <StatusBadge status={i.paymentStatus} meta={PAYMENT_STATUS_META} />
                          : <StatusBadge status={i.status} meta={INVOICE_STATUS_META} />}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
            <AuditDetail data={doc} />
            <section className="rounded-lg border border-line bg-surface p-4">
              <h3 className="font-semibold text-fg mb-2">History</h3>
              <AuditTimeline entity="salesOrder" id={doc._id} refreshKey={version} />
            </section>
          </aside>
        )}
      </div>
    </div>
  );
}
