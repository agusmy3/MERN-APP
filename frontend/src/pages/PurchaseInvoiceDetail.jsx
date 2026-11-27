import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  getVendorBill, getBillable, createVendorBill, cancelVendorBill, createVendorPayment, cancelVendorPayment, getOpenVendorDeposits, vendorDepositFromInvoice } from '../services/purchaseService';
import { getVendorDropdown } from '../services/vendorService';
import { useAuth } from '../context/AuthContext';
import usePermission from '../hooks/usePermission';
import useToast from '../hooks/useToast';
import PageHeader from '../components/PageHeader';
import FormField from '../components/FormField';
import StatusBadge from '../components/stock/StatusBadge';
import ReasonPanel from '../components/stock/ReasonPanel';
import InvoicePayments from '../components/sales/InvoicePayments';
import AuditTimeline from '../components/audit/AuditTimeline';
import { inputClass } from '../utils/formStyles';
import { formatNumber, formatRupiah, round2, variantLabel } from '../utils/formatHelper';
import { formatDate2, formatDay, toDateInput } from '../utils/dateHelper';
import { PAYMENT_STATUS_META } from '../utils/salesMeta';
import { BILL_STATUS_META, GR_STATUS_META, VENDOR_PAYMENT_METHODS, RETURN_RESOLUTIONS } from '../utils/purchaseMeta';

const btn = 'px-4 py-2 rounded text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
const btnPrimary = `${btn} bg-primary hover:bg-primary-hover text-primary-fg`;
const btnDanger = `${btn} border border-danger-line text-danger hover:bg-danger-soft`;
const th = 'px-2 py-2 border-b border-line font-semibold';
const td = 'px-2 py-1.5 border-t border-line-soft';

/** Buat tagihan: pilih vendor, centang GR (barang) & biaya angkut yang belum ditagih */
function NewBill({ token, initialVendor }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [vendors, setVendors] = useState([]);
  const [vendor, setVendor] = useState(initialVendor || '');
  const [data, setData] = useState(null);
  const [goods, setGoods] = useState(() => new Set());
  const [freight, setFreight] = useState(() => new Set());
  const [form, setForm] = useState({ vendorInvoiceNo: '', date: toDateInput(), dueDate: '', note: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getVendorDropdown(token).then(setVendors).catch(console.error);
  }, [token]);
  useEffect(() => {
    setData(null);
    setGoods(new Set());
    setFreight(new Set());
    if (!vendor) return;
    getBillable(vendor, token).then(setData).catch((err) => toast.error(err.response?.data?.message || 'Failed to load goods receipts'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor, token]);

  const toggle = (setter, id) => setter((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const selectedGoods = (data?.goods || []).filter((g) => goods.has(g._id));
  const rates = new Set(selectedGoods.map((g) => g.taxRate));
  const total = round2(selectedGoods.reduce((s, g) => s + g.amount, 0) + (data?.freight || []).filter((f) => freight.has(f._id)).reduce((s, f) => s + f.amount, 0));
  const dueDefault = data && form.date
    ? toDateInput(new Date(new Date(`${form.date}T00:00:00`).getTime() + (data.vendor.termDays || 0) * 86400000)) : '';

  const submit = async () => {
    if (!goods.size && !freight.size) return toast.warning('Pilih minimal 1 penerimaan barang atau biaya angkut.');
    if (rates.size > 1) return toast.warning('Tarif PPN PO berbeda: buat tagihan terpisah.');
    if (selectedGoods.some((g) => g.hasDraftReturn)) return toast.warning('Ada draft retur pembelian: posting / hapus dulu.');
    setBusy(true);
    try {
      const res = await createVendorBill({
        vendor, goodsReceipts: [...goods], freightReceipts: [...freight], ...form, dueDate: form.dueDate || null,
      }, token);
      toast.success(res.data.message);
      navigate(`/purchase-invoice/${res.data.data._id}`, { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create vendor bill');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 w-full">
      <section className="rounded-lg border border-line bg-surface p-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label="Vendor" htmlFor="bill-vendor" required>
          <select id="bill-vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} className={inputClass}>
            <option value="">— choose —</option>
            {vendors.map((v) => <option key={v._id} value={v._id}>{v.companyName}</option>)}
          </select>
        </FormField>
        <FormField label="Vendor invoice no." htmlFor="bill-vin">
          <input id="bill-vin" value={form.vendorInvoiceNo} maxLength={100} placeholder="No. faktur vendor"
            onChange={(e) => setForm((f) => ({ ...f, vendorInvoiceNo: e.target.value }))} className={inputClass} />
        </FormField>
        <FormField label="Invoice date" htmlFor="bill-date" required>
          <input id="bill-date" type="date" max={toDateInput()} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} className={inputClass} />
        </FormField>
        <FormField label="Due date" htmlFor="bill-due" hint={data ? `Kosong = termin vendor ${data.vendor.termDays || 0} hari (${formatDay(dueDefault)})` : undefined}>
          <input id="bill-due" type="date" min={form.date} value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} className={inputClass} />
        </FormField>
        <div className="sm:col-span-2 lg:col-span-4">
          <FormField label="Note" htmlFor="bill-note">
            <input id="bill-note" value={form.note} maxLength={500} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} className={inputClass} />
          </FormField>
        </div>
      </section>

      {vendor && !data && <p className="text-muted">Loading...</p>}
      {data && (
        <>
          <section className="rounded-lg border border-line bg-surface">
            <div className="px-4 py-3 border-b border-line">
              <h3 className="font-semibold text-fg">Goods receipts ({data.goods.length})</h3>
              <p className="text-xs text-muted">Penerimaan barang yang belum ditagih. Harga & PPN dikunci dari PO; qty = diterima − sudah diretur.</p>
            </div>
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead className="bg-head text-head-fg text-left">
                <tr><th className={`${th} w-10`}></th><th className={th}>GR</th><th className={th}>PO</th><th className={th}>Whs.</th><th className={`${th} text-right`}>PPN</th><th className={`${th} text-right`}>Amount (incl. PPN)</th></tr>
              </thead>
              <tbody>
                {data.goods.map((g) => (
                  <tr key={g._id} className={goods.has(g._id) ? 'bg-highlight' : 'hover:bg-subtle'}>
                    <td className={`${td} text-center`}>
                      <input type="checkbox" aria-label={`Bill ${g.no}`} checked={goods.has(g._id)} onChange={() => toggle(setGoods, g._id)} className="w-4 h-4 accent-primary cursor-pointer" />
                    </td>
                    <td className={td}>
                      <Link to={`/goods-receipt/${g._id}`} className="font-mono text-xs font-semibold text-primary hover:underline">{g.no}</Link>
                      <div className="text-xs text-muted">{formatDay(g.date)}{g.deliveryNoteNo ? ` · SJ ${g.deliveryNoteNo}` : ''}</div>
                      {g.hasDraftReturn && <div className="text-xs text-warning-fg">ada draft retur</div>}
                    </td>
                    <td className={`${td} font-mono text-xs`}>{g.purchaseOrder?.no}</td>
                    <td className={td}>{g.gudang?.code}</td>
                    <td className={`${td} text-right tabular-nums`}>{formatNumber(g.taxRate)}%</td>
                    <td className={`${td} text-right tabular-nums`}>{formatRupiah(g.amount)}</td>
                  </tr>
                ))}
                {!data.goods.length && <tr><td colSpan={6} className="text-center py-6 text-muted">Tidak ada penerimaan barang yang belum ditagih.</td></tr>}
              </tbody>
            </table>
          </section>

          <section className="rounded-lg border border-line bg-surface">
            <div className="px-4 py-3 border-b border-line">
              <h3 className="font-semibold text-fg">Freight charges ({data.freight.length})</h3>
              <p className="text-xs text-muted">Biaya angkut penerimaan barang yang ditagih vendor ini (dicatat di Goods Receipt), tanpa PPN tambahan.</p>
            </div>
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead className="bg-head text-head-fg text-left">
                <tr><th className={`${th} w-10`}></th><th className={th}>GR</th><th className={th}>Supplier barang</th><th className={th}>Note</th><th className={`${th} text-right`}>Amount</th></tr>
              </thead>
              <tbody>
                {data.freight.map((f) => (
                  <tr key={f._id} className={freight.has(f._id) ? 'bg-highlight' : 'hover:bg-subtle'}>
                    <td className={`${td} text-center`}>
                      <input type="checkbox" aria-label={`Bill freight ${f.no}`} checked={freight.has(f._id)} onChange={() => toggle(setFreight, f._id)} className="w-4 h-4 accent-primary cursor-pointer" />
                    </td>
                    <td className={td}><span className="font-mono text-xs font-semibold">{f.no}</span><div className="text-xs text-muted">{formatDay(f.date)} · {f.gudang?.code}</div></td>
                    <td className={td}>{f.supplier?.companyName}</td>
                    <td className={td}>{f.freightNote}</td>
                    <td className={`${td} text-right tabular-nums`}>{formatRupiah(f.amount)}</td>
                  </tr>
                ))}
                {!data.freight.length && <tr><td colSpan={5} className="text-center py-6 text-muted">Tidak ada biaya angkut yang belum ditagih.</td></tr>}
              </tbody>
            </table>
          </section>

          <div className="flex flex-wrap items-center justify-end gap-4">
            {rates.size > 1 && <span className="text-sm text-danger"><i className="fa fa-triangle-exclamation mr-1"></i>Tarif PPN PO berbeda: tagih terpisah.</span>}
            <span className="text-sm">Total tagihan <b className="tabular-nums">{formatRupiah(total)}</b></span>
            <button type="button" onClick={submit} disabled={busy || (!goods.size && !freight.size)} className={btnPrimary}>
              <i className="fa fa-file-invoice-dollar"></i> Create vendor bill
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Tagihan vendor: /purchase-invoice/new (?vendor=) atau /:id
 * Detail: barang & biaya angkut, total, retur, pembayaran (InvoicePayments), batal (tanpa pembayaran aktif).
 */
export default function PurchaseInvoiceDetail() {
  const { id } = useParams();
  const isNew = id === 'new';
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const perm = usePermission('purchaseInvoice');
  const grPerm = usePermission('goodsReceipt');
  const retPerm = usePermission('purchaseReturn');
  const toast = useToast();
  const [doc, setDoc] = useState(null);
  const [notFound, setNotFound] = useState(null);
  const [panel, setPanel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    try {
      setDoc(await getVendorBill(id, user.token));
      setVersion((v) => v + 1);
    } catch (err) {
      const s = err.response?.status;
      if ([400, 403, 404].includes(s)) setNotFound(err.response?.data?.message || 'Vendor bill not found');
      else console.error(err);
    }
  }, [id, user.token]);

  useEffect(() => {
    if (!isNew) load();
  }, [isNew, load]);

  const linesTotal = useMemo(() => (doc ? round2(doc.lines.reduce((s, l) => s + l.qty, 0)) : 0), [doc]);

  const cancel = async (reason) => {
    setBusy(true);
    try {
      const res = await cancelVendorBill(id, reason, user.token);
      toast.success(res.data.message);
      setPanel(false);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to cancel vendor bill');
    } finally {
      setBusy(false);
    }
  };

  if (isNew) {
    return (
      <div className="h-full p-4 flex flex-col overflow-auto">
        <PageHeader fallbackTitle="Vendor Bill" parentPath="/purchase-invoice" title="New Vendor Bill"
          subtitle="Tagihan vendor dari penerimaan barang (harga PO) dan biaya angkut; langsung tercatat sebagai hutang." />
        {perm.loaded && !perm.canCreate
          ? <p className="text-muted">You don&apos;t have permission to create vendor bills.</p>
          : <NewBill token={user.token} initialVendor={searchParams.get('vendor')} />}
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 text-center">
        <p className="text-xl font-semibold text-fg mb-1">Vendor bill not available</p>
        <p className="text-muted mb-6">{notFound}</p>
        <Link to="/purchase-invoice" className="bg-primary hover:bg-primary-hover text-primary-fg px-4 py-2 rounded"><i className="fa fa-arrow-left"></i> Back</Link>
      </div>
    );
  }
  if (!doc) return <div className="p-6 text-muted">Loading...</div>;
  const posted = doc.status === 'POSTED';

  return (
    <div className="h-full p-4 flex flex-col overflow-auto">
      <PageHeader
        fallbackTitle="Vendor Bill"
        parentPath="/purchase-invoice"
        title={doc.no}
        subtitle={[doc.vendor?.companyName, doc.vendorInvoiceNo && `Faktur ${doc.vendorInvoiceNo}`].filter(Boolean).join(' · ')}
        actions={(
          <>
            <StatusBadge status={doc.status} meta={BILL_STATUS_META} />
            {posted && doc.paymentStatus && <StatusBadge status={doc.paymentStatus} meta={PAYMENT_STATUS_META} />}
            {posted && perm.canUpdate && (
              <button type="button" onClick={() => setPanel((p) => !p)} disabled={busy} className={btnDanger}><i className="fa fa-ban"></i> Cancel bill</button>
            )}
          </>
        )}
      />
      {panel && (
        <ReasonPanel title={`Cancel ${doc.no}`} confirmLabel="Cancel bill" busy={busy} onConfirm={cancel} onClose={() => setPanel(false)}
          description="Hutang dihapus dan penerimaan barang / biaya angkutnya bisa ditagih ulang. Pembayaran harus dibatalkan dulu." />
      )}

      <div className="grid gap-4 items-start xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4 min-w-0">
          <section className="rounded-lg border border-line bg-surface">
            <div className="px-4 py-3 border-b border-line">
              <h3 className="font-semibold text-fg">Items ({doc.lines.length})</h3>
              <p className="text-xs text-muted">Harga & diskon dari PO; qty dalam satuan beli (diterima − diretur saat ditagih), total {formatNumber(linesTotal)}.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-separate border-spacing-0" style={{ minWidth: 760 }}>
                <thead className="bg-head text-head-fg text-left">
                  <tr><th className={th}>SKU</th><th className={th}>GR</th><th className={`${th} text-right`}>Qty</th><th className={`${th} text-right`}>Price</th><th className={`${th} text-right`}>Disc %</th><th className={`${th} text-right`}>Subtotal</th></tr>
                </thead>
                <tbody>
                  {doc.lines.map((l, i) => (
                    <tr key={i} className="hover:bg-subtle">
                      <td className={td}><div className="font-mono text-xs font-semibold">{l.sku?.sku}</div><div className="text-xs text-muted">{l.produk?.name} · {variantLabel(l.sku)}</div></td>
                      <td className={`${td} font-mono text-xs`}>{l.goodsReceipt?.no}</td>
                      <td className={`${td} text-right tabular-nums`}>{formatNumber(l.qty)} {l.uomBeli?.code}</td>
                      <td className={`${td} text-right tabular-nums`}>{formatRupiah(l.hargaBeli)}</td>
                      <td className={`${td} text-right tabular-nums`}>{l.diskonPersen ? formatNumber(l.diskonPersen) : '-'}</td>
                      <td className={`${td} text-right tabular-nums`}>{formatRupiah(l.subtotal)}</td>
                    </tr>
                  ))}
                  {doc.charges.map((c, i) => (
                    <tr key={`c${i}`} className="hover:bg-subtle">
                      <td className={td} colSpan={2}><i className="fa fa-truck text-muted mr-1.5"></i>{c.description}</td>
                      <td className={td} colSpan={3}></td>
                      <td className={`${td} text-right tabular-nums`}>{formatRupiah(c.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="ml-auto grid grid-cols-[auto_auto] gap-x-6 gap-y-1 w-fit px-4 py-3 border-t border-line text-sm">
              <dt className="text-muted">Subtotal goods</dt><dd className="text-right tabular-nums">{formatRupiah(doc.subtotal)}</dd>
              <dt className="text-muted">PPN {formatNumber(doc.taxRate)}%</dt><dd className="text-right tabular-nums">{formatRupiah(doc.taxAmount)}</dd>
              {doc.freightTotal > 0 && (<><dt className="text-muted">Freight</dt><dd className="text-right tabular-nums">{formatRupiah(doc.freightTotal)}</dd></>)}
              <dt className="font-semibold">Total</dt><dd className="text-right tabular-nums font-semibold">{formatRupiah(doc.total)}</dd>
              {posted && (
                <>
                  {doc.returnedAmount > 0 && (<><dt className="text-muted">Returned</dt><dd className="text-right tabular-nums">−{formatRupiah(doc.returnedAmount)}</dd></>)}
                  {doc.paidAmount !== 0 && (<><dt className="text-muted">Paid</dt><dd className="text-right tabular-nums">−{formatRupiah(doc.paidAmount)}</dd></>)}
                  {doc.writtenOffAmount > 0 && (<><dt className="text-muted">Written off</dt><dd className="text-right tabular-nums">−{formatRupiah(doc.writtenOffAmount)}</dd></>)}
                  <dt className="font-semibold">Balance</dt>
                  <dd className={`text-right tabular-nums font-semibold ${doc.overdue ? 'text-danger' : ''}`}>{formatRupiah(doc.balance)}</dd>
                </>
              )}
            </dl>
          </section>
        </div>

        <aside className="space-y-4 min-w-0">
          <section className="rounded-lg border border-line bg-surface p-4 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
              <dt className="text-muted">Vendor</dt><dd>{doc.vendor?.companyName}<div className="text-xs text-muted">{[doc.vendor?.picName, doc.vendor?.picContact].filter(Boolean).join(' · ')}</div></dd>
              <dt className="text-muted">Date</dt><dd>{formatDay(doc.date)}</dd>
              <dt className="text-muted">Due date</dt><dd className={doc.overdue ? 'text-danger font-semibold' : ''}>{formatDay(doc.dueDate)}{doc.overdue ? ' · overdue' : ''}</dd>
              <dt className="text-muted">Goods receipts</dt>
              <dd className="space-y-0.5">
                {[...doc.goodsReceipts, ...doc.freightReceipts.filter((f) => !doc.goodsReceipts.some((g) => g._id === f._id))].map((g) => (
                  <div key={g._id}>
                    {grPerm.canView ? <Link to={`/goods-receipt/${g._id}`} className="font-mono text-xs font-semibold text-primary hover:underline">{g.no}</Link> : <span className="font-mono text-xs">{g.no}</span>}
                    <span className="text-xs text-muted"> · {formatDay(g.date)}</span>
                  </div>
                ))}
                {!doc.goodsReceipts.length && !doc.freightReceipts.length && '-'}
              </dd>
              {doc.purchaseOrders?.length > 0 && (<><dt className="text-muted">PO</dt><dd className="font-mono text-xs">{doc.purchaseOrders.map((p) => p.no).join(', ')}</dd></>)}
              {doc.note && (<><dt className="text-muted">Note</dt><dd className="break-words">{doc.note}</dd></>)}
              <dt className="text-muted">Posted</dt><dd>{formatDate2(doc.postedDate)} · {doc.postedBy?.name || '-'}</dd>
              {doc.cancelledDate && (<><dt className="text-muted">Cancelled</dt><dd>{formatDate2(doc.cancelledDate)} · {doc.cancelledBy?.name || '-'}<div className="text-xs">{doc.cancelReason}</div></dd></>)}
            </dl>
            {doc.returns?.length > 0 && (
              <div className="pt-2 mt-2 border-t border-line-soft">
                <div className="text-xs font-semibold text-muted mb-1">Purchase returns</div>
                <ul className="space-y-1">
                  {doc.returns.map((r) => (
                    <li key={r._id} className="flex items-center justify-between gap-2">
                      {retPerm.canView ? <Link to={`/purchase-return/${r._id}`} className="font-mono text-xs font-semibold text-primary hover:underline">{r.no}</Link> : <span className="font-mono text-xs">{r.no}</span>}
                      <span className="text-xs text-muted">{RETURN_RESOLUTIONS[r.resolution]?.label}{String(r.purchaseInvoice) === String(doc._id) ? '' : ' · sebelum ditagih'}</span>
                      <StatusBadge status={r.status} meta={GR_STATUS_META} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
          {posted && (
            <InvoicePayments doc={doc} token={user.token} onChanged={load} resource="vendorPayment" invoiceKey="purchaseInvoice"
              createFn={createVendorPayment} cancelFn={cancelVendorPayment} methods={VENDOR_PAYMENT_METHODS} refundText="dikembalikan oleh vendor" batchPath="/vendor-payment-batch"
              side="purchase" partyId={doc.vendor?._id || doc.vendor} openDepositsFn={getOpenVendorDeposits} fromInvoiceFn={vendorDepositFromInvoice} depositPath="/vendor-deposit" />
          )}
          <section className="rounded-lg border border-line bg-surface p-4">
            <h3 className="font-semibold text-fg mb-2">History</h3>
            <AuditTimeline entity="purchaseInvoice" id={doc._id} refreshKey={version} />
          </section>
        </aside>
      </div>
    </div>
  );
}
