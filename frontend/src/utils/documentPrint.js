/**
 * Cetak dokumen A4 (surat jalan, Sales Order, Invoice, Quotation) lewat iframe tersembunyi + window.print()
 * (sama dengan struk POS). Kop = identitas perusahaan dari System Settings (`company.*`).
 * Surat jalan TIDAK memuat harga.
 */
import dayjs from 'dayjs';
import { printHtml } from './receiptPrint';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const qtyFmt = (n) => Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
const day = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '-');
const variantOf = (sku) => (sku?.variantValues || []).map((v) => v.value).join(' / ');
const addressOf = (a) => (a
  ? [[a.alamat ?? a.address, a.kecamatan, a.kota, a.provinsi].filter(Boolean).join(', '), a.kodePos].filter(Boolean).join(' ')
  : '');
/** qty & satuan baris (kemasan jual): "10" + "DUS (240 PCS)" */
const lineQty = (l) => qtyFmt(l.qtyUom ?? l.qty);
const lineUnit = (l) => {
  const base = l.produk?.uom?.code || '';
  const k = l.konversi || 1;
  return k > 1 ? `${esc(l.uom?.code || '')} <span class="m">(${qtyFmt(l.qty)} ${esc(base)})</span>` : esc(l.uom?.code || base);
};
const money = (n) => Number(n || 0).toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const multiline = (s) => esc(s).replace(/\n/g, '<br>');

/** Kop perusahaan dari nilai System Settings ({ 'company.name': ... }); nama kosong = tanpa kop */
const companyHead = (company = {}) => {
  const name = company['company.name'];
  if (!name) return '';
  const contact = [company['company.phone'] && `Telp. ${esc(company['company.phone'])}`, esc(company['company.email'])].filter(Boolean).join(' · ');
  return `<div class="co">
      <div class="co-name">${esc(name)}</div>
      ${company['company.address'] ? `<div>${multiline(company['company.address'])}</div>` : ''}
      ${contact ? `<div class="m">${contact}</div>` : ''}
      ${company['company.npwp'] ? `<div class="m">NPWP ${esc(company['company.npwp'])}</div>` : ''}
    </div>`;
};

const BASE_CSS = `
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #000; margin: 0; }
    h1 { font-size: 18px; margin: 0 0 2px; letter-spacing: 1px; }
    .m { color: #444; font-size: 11px; }
    .co { border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 12px; }
    .co-name { font-size: 16px; font-weight: bold; }
    .head { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 14px; }
    .box { border: 1px solid #000; padding: 8px 10px; flex: 1; }
    .box h3 { margin: 0 0 4px; font-size: 11px; text-transform: uppercase; color: #444; }
    table.i th { text-align: left; font-weight: normal; color: #444; padding: 1px 10px 1px 0; vertical-align: top; }
    table.i td { padding: 1px 0; }
    table.l { width: 100%; border-collapse: collapse; margin-top: 6px; }
    table.l th, table.l td { border: 1px solid #000; padding: 5px 6px; vertical-align: top; }
    table.l th { background: #eee; text-align: left; }
    .r { text-align: right; }
    .sign { display: flex; justify-content: space-between; gap: 24px; margin-top: 36px; }
    .sign div { flex: 1; text-align: center; }
    .sign .line { margin-top: 60px; border-top: 1px solid #000; padding-top: 3px; }
    .foot { display: flex; justify-content: space-between; gap: 24px; margin-top: 10px; }
    table.t { border-collapse: collapse; min-width: 260px; }
    table.t td { padding: 2px 6px; }
    table.t tr.g td { border-top: 1px solid #000; font-weight: bold; font-size: 13px; }
    .note { white-space: pre-line; }
    .stamp { display: inline-block; border: 2px solid #000; padding: 2px 8px; font-weight: bold; margin-top: 4px; }
`;

/** HTML surat jalan dari Delivery Order (GET /api/delivery-order/:id) */
export const deliveryNoteHtml = (d, company = {}) => {
  const pickup = d.deliveryMethod === 'PICKUP';
  const rows = (d.lines || []).map((l, i) => `<tr>
      <td class="r">${i + 1}</td>
      <td><b>${esc(l.sku?.sku)}</b><div class="m">${esc(l.produk?.name)}${variantOf(l.sku) ? ` · ${esc(variantOf(l.sku))}` : ''}</div></td>
      <td class="r">${lineQty(l)}</td>
      <td>${lineUnit(l)}</td>
      <td>${esc(l.note)}</td>
    </tr>`).join('');
  const info = (label, value) => (value ? `<tr><th>${label}</th><td>${esc(value)}</td></tr>` : '');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.no)}</title>
  <style>${BASE_CSS}</style></head><body>
    ${companyHead(company)}
    <div class="head">
      <div>
        <h1>SURAT JALAN</h1>
        <div class="m">${pickup ? 'Diambil sendiri oleh customer' : 'Pengiriman barang'}</div>
      </div>
      <table class="i">
        ${info('No.', d.no)}
        ${info('Tanggal', day(d.date))}
        ${info('Sales Order', d.salesOrder?.no)}
        ${info('PO Customer', d.salesOrder?.customerPoNo)}
        ${info('Gudang', [d.gudang?.code, d.gudang?.name].filter(Boolean).join(' — '))}
      </table>
    </div>
    <div class="head">
      <div class="box">
        <h3>${pickup ? 'Customer' : 'Kirim ke'}</h3>
        <b>${esc(d.customer?.name)}</b>
        ${!pickup && d.shipTo?.name && d.shipTo.name !== d.customer?.name ? `<div>Penerima: ${esc(d.shipTo.name)}</div>` : ''}
        ${!pickup ? `<div>${esc(addressOf(d.shipTo))}</div>` : ''}
        ${(!pickup && d.shipTo?.phone) || d.customer?.phone ? `<div class="m">Telp. ${esc((!pickup && d.shipTo?.phone) || d.customer?.phone)}</div>` : ''}
      </div>
      <div class="box">
        <h3>${pickup ? 'Pengambilan' : 'Pengiriman'}</h3>
        <table class="i">
          ${pickup ? info('Diambil oleh', d.pickedUpBy) : `${info('Kendaraan', d.vehicleNo)}${info('Sopir', d.driverName)}${info('Kurir', d.courier)}${info('No. resi', d.trackingNo)}`}
          ${info('Catatan', d.note)}
        </table>
      </div>
    </div>
    <table class="l">
      <thead><tr><th class="r" style="width:32px">#</th><th>Barang</th><th class="r" style="width:80px">Qty</th><th style="width:110px">Satuan</th><th style="width:30%">Keterangan</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="sign">
      <div>Dibuat oleh<div class="line">${esc(d.postedBy?.name || d.createdBy?.name || '')}</div></div>
      <div>${pickup ? 'Diserahkan' : 'Pengirim / Sopir'}<div class="line">${esc(pickup ? '' : d.driverName || '')}</div></div>
      <div>${pickup ? 'Diambil oleh' : 'Diterima oleh'}<div class="line">${esc(pickup ? d.pickedUpBy || '' : '')}</div></div>
    </div>
    <div class="m" style="margin-top:16px">Dicetak ${dayjs().format('DD/MM/YYYY HH:mm')}${d.status !== 'POSTED' ? ` · status ${esc(d.status)}` : ''}</div>
  </body></html>`;
};

export const printDeliveryNote = (d, company) => printHtml(deliveryNoteHtml(d, company));

/**
 * Dokumen penjualan berharga (Sales Order, Invoice, Quotation): kop, info dokumen, customer / alamat kirim,
 * baris (qty, harga, diskon, jumlah), total (subtotal, diskon, ongkir, DPP, PPN, total) + tambahan per jenis.
 * opts: { title, subtitle, stamp, info: [[label, value]], parties: [{ heading, name, lines }],
 *         extraTotals: [[label, value, bold]], payInfo (cetak instruksi bayar), notes, signs: [[label, name]] }
 */
export const salesDocumentHtml = (d, company = {}, opts = {}) => {
  const rows = (d.lines || []).map((l, i) => `<tr>
      <td class="r">${i + 1}</td>
      <td><b>${esc(l.sku?.sku)}</b><div class="m">${esc(l.produk?.name)}${variantOf(l.sku) ? ` · ${esc(variantOf(l.sku))}` : ''}</div>${l.note ? `<div class="m">${esc(l.note)}</div>` : ''}</td>
      <td class="r">${lineQty(l)}</td>
      <td>${lineUnit(l)}</td>
      <td class="r">${money(l.hargaJual)}</td>
      <td class="r">${l.diskonPersen ? `${qtyFmt(l.diskonPersen)}%` : ''}</td>
      <td class="r">${money(l.subtotal)}</td>
    </tr>`).join('');
  const info = (label, value) => (value ? `<tr><th>${label}</th><td>${esc(value)}</td></tr>` : '');
  const tr = (label, value, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="r">${value}</td></tr>`;
  const totals = [
    tr('Subtotal', money(d.subtotal)),
    d.discountAmount ? tr('Diskon', `-${money(d.discountAmount)}`) : '',
    d.shippingCharge ? tr('Ongkos kirim', money(d.shippingCharge)) : '',
    d.taxRate ? tr('DPP', money((d.dpp || 0) + (d.shippingDpp || 0))) : '',
    d.taxRate ? tr(`PPN ${qtyFmt(d.taxRate)}%`, money(d.taxAmount)) : '',
    tr('TOTAL', money(d.total), 'g'),
    ...(opts.extraTotals || []).map(([label, value, bold]) => tr(label, value, bold ? 'g' : '')),
  ].join('');
  const party = (p) => `<div class="box"><h3>${esc(p.heading)}</h3><b>${esc(p.name)}</b>${(p.lines || []).filter(Boolean).map((x) => `<div>${esc(x)}</div>`).join('')}</div>`;
  const pay = opts.payInfo && company['company.bankInfo']
    ? `<div class="box" style="flex:0 1 50%"><h3>Pembayaran</h3><div class="note">${esc(company['company.bankInfo'])}</div></div>`
    : '<div></div>';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.no)}</title>
  <style>${BASE_CSS}</style></head><body>
    ${companyHead(company)}
    <div class="head">
      <div>
        <h1>${esc(opts.title)}</h1>
        ${opts.subtitle ? `<div class="m">${esc(opts.subtitle)}</div>` : ''}
        ${opts.stamp ? `<div class="stamp">${esc(opts.stamp)}</div>` : ''}
      </div>
      <table class="i">${(opts.info || []).map(([l, v]) => info(l, v)).join('')}</table>
    </div>
    <div class="head">${(opts.parties || []).map(party).join('')}</div>
    <table class="l">
      <thead><tr><th class="r" style="width:28px">#</th><th>Barang</th><th class="r" style="width:60px">Qty</th><th style="width:100px">Satuan</th><th class="r" style="width:95px">Harga</th><th class="r" style="width:50px">Disk.</th><th class="r" style="width:105px">Jumlah</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="foot">
      ${pay}
      <table class="t">${totals}</table>
    </div>
    ${d.priceIncludesTax && d.taxRate ? '<div class="m" style="margin-top:4px">Harga sudah termasuk PPN.</div>' : ''}
    ${opts.notes ? `<div style="margin-top:10px"><b>Catatan:</b> <span class="note">${esc(opts.notes)}</span></div>` : ''}
    ${opts.signs?.length ? `<div class="sign">${opts.signs.map(([label, name]) => `<div>${esc(label)}<div class="line">${esc(name || '')}</div></div>`).join('')}</div>` : ''}
    ${company['company.documentFooter'] ? `<div class="m note" style="margin-top:14px">${esc(company['company.documentFooter'])}</div>` : ''}
    <div class="m" style="margin-top:12px">Dicetak ${dayjs().format('DD/MM/YYYY HH:mm')}</div>
  </body></html>`;
};

const customerLines = (c) => [addressOf(c), c?.phone && `Telp. ${c.phone}`, c?.npwp && `NPWP ${c.npwp}`];

/** Konfirmasi pesanan (Sales Order) untuk customer, dengan harga */
export const salesOrderHtml = (so, company = {}) => {
  const pickup = so.deliveryMethod === 'PICKUP';
  const parties = [{ heading: 'Customer', name: so.customer?.name, lines: customerLines(so.customer) }];
  if (!pickup) {
    parties.push({
      heading: 'Kirim ke',
      name: so.shipTo?.name || so.customer?.name,
      lines: [addressOf(so.shipTo), so.shipTo?.phone && `Telp. ${so.shipTo.phone}`],
    });
  }
  return salesDocumentHtml(so, company, {
    title: 'SALES ORDER',
    subtitle: pickup ? 'Konfirmasi pesanan · diambil sendiri' : 'Konfirmasi pesanan · dikirim',
    stamp: ['DRAFT', 'CANCELLED'].includes(so.status) ? so.status : null,
    info: [
      ['No.', so.no], ['Tanggal', day(so.date)], ['PO Customer', so.customerPoNo],
      ['Tgl. kirim diminta', so.requestedDate ? day(so.requestedDate) : ''],
      ['Termin', so.customer?.termDays ? `${so.customer.termDays} hari` : 'Tunai'],
    ],
    parties,
    notes: so.note,
    signs: [['Dibuat oleh', so.confirmedBy?.name || so.createdBy?.name], ['Disetujui customer', '']],
  });
};

/** Invoice penjualan: + jatuh tempo, retur, pembayaran & sisa tagihan, instruksi bayar */
export const invoiceHtml = (inv, company = {}) => {
  const extra = [];
  if (inv.status === 'POSTED' && (inv.returnedAmount || inv.paidAmount)) {
    if (inv.returnedAmount) extra.push(['Retur', `-${money(inv.returnedAmount)}`]);
    if (inv.paidAmount) extra.push(['Dibayar', `-${money(inv.paidAmount)}`]);
    extra.push(['SISA TAGIHAN', money((inv.total || 0) - (inv.returnedAmount || 0) - (inv.paidAmount || 0)), true]);
  }
  const dos = (inv.deliveryOrders?.length ? inv.deliveryOrders : [inv.deliveryOrder]).filter(Boolean);
  const sos = (inv.salesOrders?.length ? inv.salesOrders : [inv.salesOrder]).filter(Boolean);
  return salesDocumentHtml(inv, company, {
    title: 'INVOICE',
    subtitle: 'Faktur penjualan',
    stamp: inv.status !== 'POSTED' ? inv.status : (inv.paymentStatus === 'PAID' ? 'LUNAS' : null),
    info: [
      ['No.', inv.no], ['Tanggal', day(inv.date)], ['Jatuh tempo', inv.dueDate ? day(inv.dueDate) : ''],
      ['Sales Order', sos.map((x) => x.no).join(', ')],
      ['PO Customer', sos.map((x) => x.customerPoNo).filter(Boolean).join(', ')],
      ['Surat jalan', dos.map((x) => x.no).join(', ')],
    ],
    parties: [{ heading: 'Ditagihkan kepada', name: inv.customer?.name, lines: customerLines(inv.customer) }],
    extraTotals: extra,
    payInfo: true,
    notes: inv.note,
    signs: [['Hormat kami', inv.postedBy?.name || inv.createdBy?.name]],
  });
};

/** Penawaran harga: masa berlaku, calon pembeli (walk-in), syarat; instruksi bayar dicetak */
export const quotationHtml = (q, company = {}) => {
  const walkIn = q.customer?.isWalkIn;
  return salesDocumentHtml(q, company, {
    title: 'PENAWARAN HARGA',
    subtitle: 'Quotation',
    stamp: q.status === 'DRAFT' ? 'DRAFT' : (q.expired ? 'KEDALUWARSA' : null),
    info: [
      ['No.', q.no], ['Tanggal', day(q.date)], ['Berlaku s/d', day(q.validUntil)],
      ['Pengiriman', q.deliveryMethod === 'PICKUP' ? 'Diambil sendiri' : 'Dikirim'],
      ['Termin', !walkIn && q.customer?.termDays ? `${q.customer.termDays} hari` : 'Tunai'],
    ],
    parties: [walkIn
      ? { heading: 'Kepada', name: q.prospectName, lines: [q.prospectContact] }
      : { heading: 'Kepada', name: q.customer?.name, lines: customerLines(q.customer) }],
    payInfo: true,
    notes: [q.note, q.terms].filter(Boolean).join('\n\n'),
    signs: [['Hormat kami', q.sentBy?.name || q.createdBy?.name], ['Disetujui', '']],
  });
};

export const printQuotation = (q, company) => printHtml(quotationHtml(q, company));
export const printSalesOrder = (so, company) => printHtml(salesOrderHtml(so, company));
export const printInvoice = (inv, company) => printHtml(invoiceHtml(inv, company));

/**
 * Kuitansi / bukti pembayaran gabungan (CustomerReceipt / VendorPaymentBatch):
 * opts { title, subtitle, partyHeading, partyName, invoiceField, methods }
 */
export const paymentBatchHtml = (d, company = {}, opts = {}) => {
  const rows = (d.allocations || []).map((a, i) => {
    const inv = a[opts.invoiceField] || {};
    return `<tr>
      <td class="r">${i + 1}</td>
      <td><b>${esc(inv.no)}</b>${inv.vendorInvoiceNo ? `<div class="m">Faktur ${esc(inv.vendorInvoiceNo)}</div>` : ''}</td>
      <td>${day(inv.date)}</td>
      <td>${inv.dueDate ? day(inv.dueDate) : ''}</td>
      <td class="r">${money(inv.total)}</td>
      <td class="r"><b>${money(a.amount)}</b></td>
    </tr>`;
  }).join('');
  const info = (label, value) => (value ? `<tr><th>${label}</th><td>${esc(value)}</td></tr>` : '');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.no)}</title>
  <style>${BASE_CSS}</style></head><body>
    ${companyHead(company)}
    <div class="head">
      <div>
        <h1>${esc(opts.title)}</h1>
        ${opts.subtitle ? `<div class="m">${esc(opts.subtitle)}</div>` : ''}
        ${d.status === 'CANCELLED' ? '<div class="stamp">DIBATALKAN</div>' : ''}
      </div>
      <table class="i">
        ${info('No.', d.no)}${info('Tanggal', day(d.date))}${info('Metode', opts.methods?.[d.method] || d.method)}${info('Referensi', d.reference)}
      </table>
    </div>
    <div class="head"><div class="box"><h3>${esc(opts.partyHeading)}</h3><b>${esc(opts.partyName)}</b></div>
      <div class="box"><h3>Jumlah</h3><b style="font-size:16px">Rp ${money(d.amount)}</b></div></div>
    <table class="l">
      <thead><tr><th class="r" style="width:28px">#</th><th>Untuk pembayaran</th><th style="width:95px">Tanggal</th><th style="width:95px">Jatuh tempo</th><th class="r" style="width:110px">Total</th><th class="r" style="width:110px">Dibayar</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${d.note ? `<div style="margin-top:10px"><b>Catatan:</b> <span class="note">${esc(d.note)}</span></div>` : ''}
    <div class="sign"><div>Penerima<div class="line"></div></div><div>Penyetor<div class="line"></div></div></div>
    ${company['company.documentFooter'] ? `<div class="m note" style="margin-top:14px">${esc(company['company.documentFooter'])}</div>` : ''}
    <div class="m" style="margin-top:12px">Dicetak ${dayjs().format('DD/MM/YYYY HH:mm')}</div>
  </body></html>`;
};

export const printPaymentBatch = (d, company, opts) => printHtml(paymentBatchHtml(d, company, opts));
