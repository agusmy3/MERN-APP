/**
 * Cetak dokumen A4 (surat jalan) lewat iframe tersembunyi + window.print() (sama dengan struk POS).
 * Surat jalan TIDAK memuat harga.
 */
import dayjs from 'dayjs';
import { printHtml } from './receiptPrint';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const qtyFmt = (n) => Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 });
const day = (d) => (d ? dayjs(d).format('DD MMM YYYY') : '-');
const variantOf = (sku) => (sku?.variantValues || []).map((v) => v.value).join(' / ');
const addressOf = (a) => (a
  ? [[a.alamat, a.kecamatan, a.kota, a.provinsi].filter(Boolean).join(', '), a.kodePos].filter(Boolean).join(' ')
  : '');

/** HTML surat jalan dari Delivery Order (GET /api/delivery-order/:id) */
export const deliveryNoteHtml = (d) => {
  const pickup = d.deliveryMethod === 'PICKUP';
  const rows = (d.lines || []).map((l, i) => `<tr>
      <td class="r">${i + 1}</td>
      <td><b>${esc(l.sku?.sku)}</b><div class="m">${esc(l.produk?.name)}${variantOf(l.sku) ? ` · ${esc(variantOf(l.sku))}` : ''}</div></td>
      <td class="r">${qtyFmt(l.qty)}</td>
      <td>${esc(l.produk?.uom?.code)}</td>
      <td>${esc(l.note)}</td>
    </tr>`).join('');
  const info = (label, value) => (value ? `<tr><th>${label}</th><td>${esc(value)}</td></tr>` : '');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.no)}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #000; margin: 0; }
    h1 { font-size: 18px; margin: 0 0 2px; letter-spacing: 1px; }
    .m { color: #444; font-size: 11px; }
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
  </style></head><body>
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
      <thead><tr><th class="r" style="width:32px">#</th><th>Barang</th><th class="r" style="width:80px">Qty</th><th style="width:60px">Satuan</th><th style="width:30%">Keterangan</th></tr></thead>
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

export const printDeliveryNote = (d) => printHtml(deliveryNoteHtml(d));
