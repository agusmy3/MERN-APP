import dayjs from 'dayjs';
import { PAYMENT_METHODS } from './salesMeta';

/**
 * Cetak struk POS lewat iframe tersembunyi + window.print() (tanpa popup). Lebar kertas 58 / 80 mm
 * dari pengaturan outlet. receipt = data GET /api/pos/sales/:id/receipt.
 */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
const qtyFmt = (n) => Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
const variantOf = (sku) => (sku?.variantValues || []).map((v) => v.value).join(' / ');

export const receiptHtml = (r) => {
  const width = r.outlet?.receiptWidth === 80 ? 80 : 58;
  const row = (left, right, cls = '') => `<div class="row ${cls}"><span>${left}</span><span>${right}</span></div>`;
  const lines = r.lines.map((l) => {
    const name = [l.produk?.name, variantOf(l.sku)].filter(Boolean).join(' ');
    const disc = l.diskonPersen ? ` -${qtyFmt(l.diskonPersen)}%` : '';
    return `<div class="item">${esc(name || l.sku?.sku)}</div>${row(`${qtyFmt(l.qty)} x ${money(l.hargaJual)}${disc}`, money(l.subtotal))}`;
  }).join('');
  const pays = (r.payments || []).map((p) => row(esc(PAYMENT_METHODS[p.method] || p.method), money(p.amount))).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.no)}</title><style>
    @page { size: ${width}mm auto; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 3mm; width: ${width}mm; font: ${width === 80 ? 12 : 10.5}px/1.35 'Courier New', monospace; color: #000; }
    .c { text-align: center; } .b { font-weight: bold; } .sm { font-size: 0.9em; }
    .row { display: flex; justify-content: space-between; gap: 4px; }
    .row span:last-child { text-align: right; white-space: nowrap; }
    .item { margin-top: 2px; word-break: break-word; }
    hr { border: 0; border-top: 1px dashed #000; margin: 4px 0; }
    .pre { white-space: pre-wrap; }
  </style></head><body>
    <div class="c b">${esc(r.outlet?.name)}</div>
    ${r.outlet?.receiptHeader ? `<div class="c sm pre">${esc(r.outlet.receiptHeader)}</div>` : ''}
    ${r.outlet?.alamat ? `<div class="c sm">${esc(r.outlet.alamat)}${r.outlet.kota ? `, ${esc(r.outlet.kota)}` : ''}</div>` : ''}
    ${r.outlet?.phone ? `<div class="c sm">Telp ${esc(r.outlet.phone)}</div>` : ''}
    <hr>
    ${row(esc(r.no), dayjs(r.date).format('DD/MM/YY HH:mm'), 'sm')}
    ${row('Kasir', esc(r.createdBy?.name || '-'), 'sm')}
    ${r.customer && !r.customer.isWalkIn ? row('Customer', esc(r.customer.name), 'sm') : ''}
    <hr>
    ${lines}
    <hr>
    ${row('Subtotal', money(r.subtotal))}
    ${r.discountAmount ? row('Diskon', `-${money(r.discountAmount)}`) : ''}
    ${r.taxRate ? row(`PPN ${qtyFmt(r.taxRate)}%${r.priceIncludesTax ? ' (incl.)' : ''}`, money(r.taxAmount), 'sm') : ''}
    ${row('TOTAL', money(r.total), 'b')}
    <hr>
    ${pays}
    ${r.cashTendered ? row('Tunai diterima', money(r.cashTendered), 'sm') : ''}
    ${r.change ? row('Kembali', money(r.change), 'b') : ''}
    ${r.status === 'CANCELLED' ? '<hr><div class="c b">*** DIBATALKAN ***</div>' : ''}
    ${r.outlet?.receiptFooter ? `<hr><div class="c sm pre">${esc(r.outlet.receiptFooter)}</div>` : ''}
  </body></html>`;
};

export const printReceipt = (receipt) => {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open();
  doc.write(receiptHtml(receipt));
  doc.close();
  const done = () => setTimeout(() => frame.remove(), 1000);
  frame.contentWindow.onafterprint = done;
  setTimeout(() => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    done();
  }, 100);
};
