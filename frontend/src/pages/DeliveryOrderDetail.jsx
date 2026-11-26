import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  getDeliveryOrder,
  getSoForDelivery,
  getDeliverySoOptions,
  createDeliveryOrder,
  updateDeliveryOrder,
  deleteDeliveryOrder,
  postDeliveryOrder,
  cancelDeliveryOrder,
  invoiceDeliveryOrder,
} from '../services/salesService';
import { useAuth } from '../context/AuthContext';
import usePermission from '../hooks/usePermission';
import useToast from '../hooks/useToast';
import useConfirm from '../hooks/useConfirm';
import PageHeader from '../components/PageHeader';
import FormField from '../components/FormField';
import StatusBadge from '../components/stock/StatusBadge';
import ReasonPanel from '../components/stock/ReasonPanel';
import DeliveryInvoicePanel from '../components/sales/DeliveryInvoicePanel';
import AuditTimeline from '../components/audit/AuditTimeline';
import { AuditDetail } from '../components/AuditInfo';
import { inputClass } from '../utils/formStyles';
import { formatNumber, formatRupiah, variantLabel } from '../utils/formatHelper';
import { formatDate2, formatDay, toDateInput } from '../utils/dateHelper';
import { DO_STATUS_META, SO_STATUS_META, INVOICE_STATUS_META, PAYMENT_STATUS_META, DELIVERY_METHODS, addressLine } from '../utils/salesMeta';
import { printDeliveryNote } from '../utils/documentPrint';
import { getSettings } from '../services/purchaseService';

const cellInput = `w-full bg-input text-fg border border-line rounded px-2 py-1 text-sm
  focus:outline-none focus:border-primary disabled:bg-transparent disabled:border-transparent`;
const btn = 'px-4 py-2 rounded text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
const btnGhost = `${btn} border border-line hover:bg-subtle`;
const btnPrimary = `${btn} bg-primary hover:bg-primary-hover text-primary-fg`;
const btnDanger = `${btn} border border-danger-line text-danger hover:bg-danger-soft`;

// baris form dari baris SO (+ isian DO jika ada)
const lineFromSo = (sl, dl) => ({
  sku: sl.sku?._id,
  code: sl.sku?.sku ?? '(deleted SKU)',
  produkName: sl.produk?.name || '',
  variant: variantLabel(sl.sku),
  uom: sl.produk?.uom?.code || '',
  ordered: sl.qty,
  delivered: sl.qtyDelivered || 0,
  outstanding: sl.outstanding,
  currentQty: sl.currentQty ?? null,
  qty: dl ? dl.qty : '',
  note: dl?.note || '',
  unitCost: null,
});

// baris DO yang sudah diposting / dibatalkan
const lineFromDo = (l) => ({
  sku: l.sku?._id,
  code: l.sku?.sku ?? '(deleted SKU)',
  produkName: l.produk?.name || '',
  variant: variantLabel(l.sku),
  uom: l.produk?.uom?.code || '',
  ordered: l.ordered,
  delivered: l.delivered,
  outstanding: l.outstanding,
  currentQty: null,
  qty: l.qty,
  note: l.note || '',
  unitCost: l.unitCost ?? null,
});

const EMPTY_HEADER = { date: toDateInput(), vehicleNo: '', driverName: '', courier: '', trackingNo: '', pickedUpBy: '', note: '' };

const toPayload = (form, lines) => ({
  salesOrder: form.salesOrder,
  date: form.date,
  vehicleNo: form.vehicleNo,
  driverName: form.driverName,
  courier: form.courier,
  trackingNo: form.trackingNo,
  pickedUpBy: form.pickedUpBy,
  note: form.note,
  lines: lines.filter((l) => l.qty !== '' && Number(l.qty) !== 0).map((l) => ({ sku: l.sku, qty: l.qty, note: l.note })),
});

/** Pilih SO yang bisa dikirim (OPEN / PARTIAL) */
function SoSelect({ token, onSelect }) {
  const [search, setSearch] = useState('');
  const [list, setList] = useState([]);
  useEffect(() => {
    const t = setTimeout(() => getDeliverySoOptions(token, search).then(setList).catch(console.error), 300);
    return () => clearTimeout(t);
  }, [token, search]);
  return (
    <section className="rounded-lg border border-line bg-surface p-4 space-y-3 max-w-3xl">
      <div>
        <h3 className="font-semibold text-fg">Pilih Sales Order</h3>
        <p className="text-sm text-muted">Surat jalan dibuat dari SO yang sudah dikonfirmasi dan belum selesai dikirim.</p>
      </div>
      <input type="search" aria-label="Search sales order" placeholder="Cari nomor SO, PO customer, nama customer..." value={search}
        onChange={(e) => setSearch(e.target.value)} className={inputClass} autoFocus />
      <ul className="divide-y divide-line-soft border border-line rounded">
        {list.map((so) => (
          <li key={so._id}>
            <button type="button" onClick={() => onSelect(so._id)} className="w-full text-left px-3 py-2 hover:bg-subtle cursor-pointer flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="font-mono text-sm font-semibold text-primary">{so.no}</span>
              <span className="text-sm">{so.customer?.name}</span>
              <span className="text-xs text-muted">
                {so.gudang?.code} · {DELIVERY_METHODS[so.deliveryMethod]?.label}{so.requestedDate ? ` · minta ${formatDay(so.requestedDate)}` : ''}
              </span>
              <span className="ml-auto"><StatusBadge status={so.status} meta={SO_STATUS_META} /></span>
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="px-3 py-3 text-sm text-muted">Tidak ada sales order yang menunggu pengiriman.</li>}
      </ul>
    </section>
  );
}

/**
 * Delivery Order / surat jalan: /delivery-order/:id (id = 'new', ?so=<soId>)
 *   Draft  : qty kirim per baris SO (default = sisa), data kendaraan / sopir / resi (dikirim) atau nama pengambil
 *   Post   : stok keluar dari gudang SO (izin post), HPP dicatat; SO jadi Partial / Delivered
 *   Invoice: buat invoice POSTED atas surat jalan ini (izin salesInvoice create + post)
 *   Cancel : stok kembali (hanya jika belum ditagih)
 */
export default function DeliveryOrderDetail() {
  const { id } = useParams();
  const isNew = id === 'new';
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const perm = usePermission('deliveryOrder');
  const soPerm = usePermission('salesOrder');
  const invPerm = usePermission('salesInvoice');
  const movementPerm = usePermission('stockMovement');
  const canSeeCost = usePermission('vendorPrice').canView;
  const toast = useToast();
  const confirm = useConfirm();

  const [doc, setDoc] = useState(null);
  const [so, setSo] = useState(null);
  const [notFound, setNotFound] = useState(null);
  const [form, setForm] = useState(null);
  const [lines, setLines] = useState([]);
  const [savedPayload, setSavedPayload] = useState(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [panel, setPanel] = useState(null); // 'cancel' | 'invoice'

  const startFromSo = useCallback(async (soId) => {
    try {
      const s = await getSoForDelivery(soId, user.token);
      if (!['OPEN', 'PARTIAL'].includes(s.status)) {
        toast.warning(`${s.no} tidak bisa dikirim (status ${s.status}).`);
        return;
      }
      setSo(s);
      setForm({ ...EMPTY_HEADER, date: toDateInput(), salesOrder: s._id });
      setLines(s.lines.filter((l) => l.outstanding > 0).map((l) => ({ ...lineFromSo(l), qty: Math.min(l.outstanding, Math.max(l.currentQty, 0)) })));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to load sales order');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.token]);

  const load = useCallback(async () => {
    try {
      const d = await getDeliveryOrder(id, user.token);
      const f = {
        salesOrder: d.salesOrder?._id, date: toDateInput(d.date), vehicleNo: d.vehicleNo || '', driverName: d.driverName || '',
        courier: d.courier || '', trackingNo: d.trackingNo || '', pickedUpBy: d.pickedUpBy || '', note: d.note || '',
      };
      let ls;
      if (d.status === 'DRAFT') {
        const s = await getSoForDelivery(d.salesOrder._id, user.token);
        setSo(s);
        const bySku = new Map(d.lines.map((l) => [String(l.sku?._id), l]));
        ls = s.lines.filter((l) => l.outstanding > 0 || bySku.has(String(l.sku?._id))).map((l) => lineFromSo(l, bySku.get(String(l.sku?._id))));
      } else {
        setSo(null);
        ls = d.lines.map(lineFromDo);
      }
      setDoc(d);
      setForm(f);
      setLines(ls);
      setSavedPayload(JSON.stringify(toPayload(f, ls)));
      setVersion((v) => v + 1);
    } catch (err) {
      const s = err.response?.status;
      if ([400, 403, 404].includes(s)) setNotFound(s === 403 ? err.response?.data?.message : 'Surat jalan mungkin sudah dihapus.');
      else console.error(err);
    }
  }, [id, user.token]);

  useEffect(() => {
    if (!isNew) {
      load();
      return;
    }
    setDoc(null);
    setSo(null);
    setForm(null);
    setLines([]);
    setSavedPayload(null);
    const soId = searchParams.get('so');
    if (soId) startFromSo(soId);
  }, [isNew, load, searchParams, startFromSo]);

  const status = isNew ? 'DRAFT' : doc?.status;
  const isDraft = status === 'DRAFT';
  const editable = isNew ? perm.canCreate : isDraft && perm.canUpdate;
  const payload = form ? toPayload(form, lines) : null;
  const dirty = editable && (isNew ? true : JSON.stringify(payload) !== savedPayload);
  const method = so?.deliveryMethod || doc?.deliveryMethod || 'DELIVERY';
  const pickup = method === 'PICKUP';
  const shipTo = so?.shipTo || doc?.shipTo;

  const setLine = (sku, patch) => setLines((prev) => prev.map((l) => (l.sku === sku ? { ...l, ...patch } : l)));
  const summary = useMemo(() => {
    const filled = lines.filter((l) => l.qty !== '' && Number(l.qty) > 0);
    const over = lines.filter((l) => isDraft && l.qty !== '' && Number(l.qty) > l.outstanding);
    const short = lines.filter((l) => isDraft && l.currentQty !== null && Number(l.qty) > l.currentQty);
    return { filled: filled.length, over: over.length, short: short.length, qty: filled.reduce((s, l) => s + Number(l.qty), 0) };
  }, [lines, isDraft]);

  // ---------- aksi ----------
  const validate = () => {
    if (!summary.filled) return 'Isi qty kirim minimal untuk 1 item.';
    if (summary.over) return `${summary.over} item melebihi sisa SO.`;
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
      const res = isNew ? await createDeliveryOrder(payload, user.token) : await updateDeliveryOrder(id, payload, user.token);
      if (!quiet) toast.success(res.data.message);
      const savedId = res.data.data._id;
      if (isNew && !stay) navigate(`/delivery-order/${savedId}`, { replace: true });
      else if (!isNew && !stay) await load();
      return savedId;
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save delivery order');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const post = async () => {
    const error = validate();
    if (error) return toast.warning(error);
    const ok = await confirm({
      title: `Post ${doc?.no || 'delivery order'}?`,
      message: `${summary.filled} item (${formatNumber(summary.qty)} qty) keluar dari stok gudang ${so?.gudang?.code || doc?.gudang?.code || ''} sekarang.`
        + (summary.short ? ` ${summary.short} item melebihi stok gudang (posting akan ditolak).` : '')
        + ' Setelah diposting hanya bisa dibatalkan.',
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
      const res = await postDeliveryOrder(docId, user.token);
      toast.success(res.data.message);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to post delivery order');
    } finally {
      setBusy(false);
      if (isNew) navigate(`/delivery-order/${docId}`, { replace: true });
      else await load();
    }
  };

  const removeDraft = async () => {
    const ok = await confirm({ title: `Delete ${doc.no}?`, message: 'Draft surat jalan ini akan dihapus. Stok tidak terpengaruh.', confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
    try {
      const res = await deleteDeliveryOrder(id, user.token);
      toast.success(res.data.message);
      navigate('/delivery-order');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete delivery order');
    }
  };

  const cancelDoc = async (reason) => {
    setBusy(true);
    try {
      const res = await cancelDeliveryOrder(id, reason, user.token);
      toast.success(res.data.message);
      setPanel(null);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to cancel delivery order');
    } finally {
      setBusy(false);
    }
  };

  const createInvoice = async (body) => {
    setBusy(true);
    try {
      const res = await invoiceDeliveryOrder(id, body, user.token);
      toast.success(res.data.message);
      setPanel(null);
      navigate(`/sales-invoice/${res.data.data._id}`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create invoice');
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
    printDeliveryNote(doc, company);
  };

  // ---------- render ----------
  if (notFound) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <p className="text-xl font-semibold text-fg mb-1">Delivery order not available</p>
        <p className="text-muted mb-6">{notFound}</p>
        <Link to="/delivery-order" className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded">
          <i className="fa fa-arrow-left"></i> Back to Delivery Order
        </Link>
      </div>
    );
  }
  if (isNew && perm.loaded && !perm.canCreate) {
    return <div className="p-6 text-muted">You don&apos;t have permission to create delivery orders.</div>;
  }

  const soNo = doc?.salesOrder?.no || so?.no;
  const customer = doc?.customer || so?.customer;
  const header = (
    <PageHeader
      fallbackTitle="Delivery Order"
      parentPath="/delivery-order"
      title={doc?.no || 'New Delivery Order'}
      subtitle={(so || doc) && [soNo, customer?.name].filter(Boolean).join(' · ')}
      actions={form && (
        <>
          {!isNew && <StatusBadge status={status} meta={DO_STATUS_META} />}
          {doc && (
            <button type="button" onClick={printDoc} disabled={busy} className={btnGhost} title="Cetak surat jalan (tanpa harga)">
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
          {isDraft && perm.canPost && (!isNew || perm.canCreate) && (
            <button type="button" onClick={post} disabled={busy || !summary.filled || (dirty && !editable)} className={btnPrimary}>
              <i className="fa fa-check-double"></i> {dirty ? 'Save & Post' : 'Post'}
            </button>
          )}
          {status === 'POSTED' && !doc.invoice && doc.canInvoice && (
            <button type="button" onClick={() => setPanel((p) => (p === 'invoice' ? null : 'invoice'))} disabled={busy} className={btnPrimary}>
              <i className="fa fa-file-invoice-dollar"></i> Create invoice
            </button>
          )}
          {status === 'POSTED' && !doc.invoice && perm.canPost && (
            <button type="button" onClick={() => setPanel((p) => (p === 'cancel' ? null : 'cancel'))} disabled={busy} className={btnDanger}>
              <i className="fa fa-ban"></i> Cancel DO
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
        <SoSelect token={user.token} onSelect={(soId) => navigate(`/delivery-order/new?so=${soId}`, { replace: true })} />
      </div>
    );
  }
  if (!form) return <div className="p-6 text-muted">Loading...</div>;

  const gudang = so?.gudang || doc?.gudang;
  const text = (key, label, props = {}) => (
    <FormField label={label} htmlFor={`do-${key}`}>
      <input id={`do-${key}`} value={form[key]} maxLength={120} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} className={inputClass} {...props} />
    </FormField>
  );

  return (
    <div className="h-full p-4 flex flex-col overflow-auto">
      {header}

      {panel === 'cancel' && (
        <ReasonPanel
          title={`Cancel ${doc.no}`}
          description="Barang kembali ke stok gudang dengan HPP yang sama (movement pembalik) dan qty terkirim di SO berkurang."
          confirmLabel="Cancel DO"
          busy={busy}
          onConfirm={cancelDoc}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'invoice' && (
        <DeliveryInvoicePanel
          title={`Buat invoice untuk ${doc.no}`}
          description={`Invoice langsung diposting dengan harga & diskon dari ${doc.salesOrder?.no || 'SO'}. Stok tidak berubah lagi (sudah keluar di surat jalan ini). `
            + 'Ongkir SO ditagih di invoice pertama SO tsb. Untuk menggabungkan beberapa surat jalan dalam 1 invoice, pilih di daftar Delivery Order.'}
          minDate={doc.date}
          busy={busy}
          onConfirm={createInvoice}
          onClose={() => setPanel(null)}
        />
      )}

      <div className={`grid gap-4 items-start ${doc ? 'xl:grid-cols-[minmax(0,1fr)_320px]' : ''}`}>
        <div className="space-y-4 min-w-0">
          <section className="rounded-lg border border-line bg-surface p-4">
            <fieldset disabled={!editable || busy} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <FormField label="Sales Order">
                <div className="px-4 py-2 font-mono text-sm">
                  {soPerm.canView
                    ? <Link to={`/sales-order/${form.salesOrder}`} className="text-primary hover:underline">{soNo}</Link>
                    : soNo}
                  <span className="ml-2 font-sans text-xs text-muted">dari {gudang?.code}</span>
                </div>
              </FormField>
              <FormField label="Delivery date" htmlFor="do-date" required>
                <input id="do-date" type="date" max={toDateInput()} value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className={inputClass} />
              </FormField>
              <FormField label="Method">
                <div className="px-1 py-2 text-sm"><i className={`fa ${DELIVERY_METHODS[method]?.icon} text-muted mr-1.5`}></i>{DELIVERY_METHODS[method]?.label}</div>
              </FormField>
              {pickup ? text('pickedUpBy', 'Picked up by', { placeholder: 'Nama pengambil' }) : (
                <>
                  {text('vehicleNo', 'Vehicle No.', { placeholder: 'B 1234 CD' })}
                  {text('driverName', 'Driver')}
                  {text('courier', 'Courier / expedition', { placeholder: 'Optional' })}
                  {text('trackingNo', 'Tracking No.', { placeholder: 'No. resi' })}
                </>
              )}
              <div className="sm:col-span-2">
                <FormField label="Note" htmlFor="do-note">
                  <input id="do-note" value={form.note} maxLength={500} placeholder="Optional"
                    onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className={inputClass} />
                </FormField>
              </div>
            </fieldset>
            {!pickup && shipTo && (
              <p className="mt-3 text-sm"><span className="text-muted">Kirim ke:</span> {[shipTo.name, shipTo.phone].filter(Boolean).join(' · ')}{shipTo.name || shipTo.phone ? ' — ' : ''}{addressLine(shipTo) || '-'}</p>
            )}
          </section>

          <section className="rounded-lg border border-line bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-line">
              <div>
                <h3 className="font-semibold text-fg">Items</h3>
                <p className="text-xs text-muted">Qty dalam satuan dasar. Kosongkan / 0 untuk item yang tidak dikirim sekarang (sisanya bisa dikirim dengan surat jalan berikutnya).</p>
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
              <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: 860 }}>
                <thead className="bg-head text-head-fg text-left">
                  <tr>
                    <th className="px-2 py-2 border-b border-line font-semibold">SKU</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-24 text-right">Ordered</th>
                    <th className="px-2 py-2 border-b border-line font-semibold w-24 text-right">Delivered</th>
                    {isDraft && <th className="px-2 py-2 border-b border-line font-semibold w-24 text-right">Outstanding</th>}
                    {isDraft && <th className="px-2 py-2 border-b border-line font-semibold w-24 text-right" title="Saldo gudang saat ini">Stock</th>}
                    <th className="px-2 py-2 border-b border-line font-semibold w-32 text-right">This delivery</th>
                    {canSeeCost && !isDraft && <th className="px-2 py-2 border-b border-line font-semibold w-28 text-right" title="HPP saat diposting">HPP</th>}
                    <th className="px-2 py-2 border-b border-line font-semibold w-48">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, index) => {
                    const qty = l.qty === '' ? null : Number(l.qty);
                    const over = isDraft && qty !== null && qty > l.outstanding;
                    const short = isDraft && qty !== null && l.currentQty !== null && qty > l.currentQty;
                    return (
                      <tr key={l.sku || index} className={over || short ? 'bg-danger-soft' : 'hover:bg-subtle'}>
                        <td className="px-2 py-1.5 border-t border-line-soft">
                          <div className="font-mono text-xs font-semibold">{l.code}</div>
                          <div className="text-xs text-muted truncate max-w-64">{l.produkName} · {l.variant}</div>
                        </td>
                        <td className="px-2 py-1.5 border-t border-line-soft text-right tabular-nums">{l.ordered === null || l.ordered === undefined ? '-' : `${formatNumber(l.ordered)} ${l.uom}`}</td>
                        <td className="px-2 py-1.5 border-t border-line-soft text-right tabular-nums text-muted">{l.delivered === null || l.delivered === undefined ? '-' : formatNumber(l.delivered)}</td>
                        {isDraft && <td className="px-2 py-1.5 border-t border-line-soft text-right tabular-nums">{formatNumber(l.outstanding)}</td>}
                        {isDraft && <td className={`px-2 py-1.5 border-t border-line-soft text-right tabular-nums ${short ? 'text-danger font-semibold' : 'text-muted'}`}>{l.currentQty === null ? '-' : formatNumber(l.currentQty)}</td>}
                        <td className="px-2 py-1.5 border-t border-line-soft text-right">
                          {editable ? (
                            <input aria-label={`Deliver ${l.code}`} type="number" min="0" max={l.outstanding} step="0.01" data-qty-index={index}
                              value={l.qty} disabled={busy} onChange={(e) => setLine(l.sku, { qty: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key !== 'Enter') return;
                                e.preventDefault();
                                document.querySelector(`[data-qty-index="${index + 1}"]`)?.focus();
                              }}
                              className={`${cellInput} text-right tabular-nums`} />
                          ) : <span className="tabular-nums font-medium">{formatNumber(l.qty)} {l.uom}</span>}
                          {over && <div className="text-[10px] text-danger mt-0.5">melebihi sisa SO</div>}
                          {!over && short && <div className="text-[10px] text-danger mt-0.5">stok kurang</div>}
                        </td>
                        {canSeeCost && !isDraft && <td className="px-2 py-1.5 border-t border-line-soft text-right tabular-nums text-muted">{l.unitCost === null ? '-' : formatRupiah(l.unitCost)}</td>}
                        <td className="px-2 py-1.5 border-t border-line-soft">
                          {editable ? (
                            <input aria-label={`Note ${l.code}`} value={l.note} maxLength={200} disabled={busy}
                              onChange={(e) => setLine(l.sku, { note: e.target.value })} className={cellInput} />
                          ) : <span className="text-muted">{l.note}</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {lines.length === 0 && (
                    <tr><td colSpan={7} className="text-center py-8 text-muted">Semua item SO ini sudah dikirim.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 border-t border-line text-sm">
              {summary.filled} item · {formatNumber(summary.qty)} qty
              {canSeeCost && doc?.totalValue !== undefined && <> · nilai HPP keluar <b className="tabular-nums">{formatRupiah(doc.totalValue)}</b></>}
              {summary.over > 0 && <span className="ml-2 text-danger"><i className="fa fa-triangle-exclamation mr-1"></i>{summary.over} item melebihi sisa SO</span>}
              {summary.short > 0 && <span className="ml-2 text-danger"><i className="fa fa-triangle-exclamation mr-1"></i>{summary.short} item melebihi stok gudang (posting akan ditolak)</span>}
            </div>
          </section>
        </div>

        {doc && (
          <aside className="space-y-4 min-w-0">
            <section className="rounded-lg border border-line bg-surface p-4 text-sm space-y-2">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                <dt className="text-muted">Status</dt><dd><StatusBadge status={doc.status} meta={DO_STATUS_META} /></dd>
                <dt className="text-muted">Customer</dt><dd className="break-words">{doc.customer?.name}{doc.customer?.phone && <div className="text-xs text-muted">{doc.customer.phone}</div>}</dd>
                <dt className="text-muted">Warehouse</dt><dd>{doc.gudang?.code} — {doc.gudang?.name}</dd>
                {doc.salesOrder?.customerPoNo && (<><dt className="text-muted">Customer PO</dt><dd>{doc.salesOrder.customerPoNo}</dd></>)}
                {doc.postedDate && (<><dt className="text-muted">Posted</dt><dd>{formatDate2(doc.postedDate)} · {doc.postedBy?.name || '-'}</dd></>)}
                {doc.cancelledDate && (<><dt className="text-muted">Cancelled</dt><dd>{formatDate2(doc.cancelledDate)} · {doc.cancelledBy?.name || '-'}</dd></>)}
                {doc.cancelReason && (<><dt className="text-muted">Reason</dt><dd className="break-words">{doc.cancelReason}</dd></>)}
              </dl>
              {doc.status === 'POSTED' && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pt-2 border-t border-line-soft">
                  <dt className="text-muted">Invoice</dt>
                  <dd className="flex flex-wrap items-center gap-2">
                    {doc.invoice ? (
                      <>
                        {invPerm.canView
                          ? <Link to={`/sales-invoice/${doc.invoice._id}`} className="font-mono text-xs font-semibold text-primary hover:underline">{doc.invoice.no}</Link>
                          : <span className="font-mono text-xs">{doc.invoice.no}</span>}
                        {doc.invoice.paymentStatus
                          ? <StatusBadge status={doc.invoice.paymentStatus} meta={PAYMENT_STATUS_META} />
                          : <StatusBadge status={doc.invoice.status} meta={INVOICE_STATUS_META} />}
                      </>
                    ) : <span className="text-xs px-1.5 py-0.5 rounded bg-warning-soft text-warning-fg">Belum ditagih</span>}
                  </dd>
                </dl>
              )}
              {doc.status !== 'DRAFT' && movementPerm.canView && (
                <Link to={`/stock-movement?search=${encodeURIComponent(doc.no)}`} className="inline-block text-primary hover:underline">
                  <i className="fa fa-right-left mr-1"></i> View stock movements
                </Link>
              )}
            </section>
            <AuditDetail data={doc} />
            <section className="rounded-lg border border-line bg-surface p-4">
              <h3 className="font-semibold text-fg mb-2">History</h3>
              <AuditTimeline entity="deliveryOrder" id={doc._id} refreshKey={version} />
            </section>
          </aside>
        )}
      </div>
    </div>
  );
}
