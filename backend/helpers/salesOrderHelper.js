const mongoose = require('mongoose');
const { round2 } = require('./number');
const { goodsTotal } = require('./salesHelper');

/**
 * Qty "dipesan customer" per SKU di 1 gudang = sisa baris Sales Order OPEN / PARTIAL (qty - qtyDelivered).
 * Hanya informasi (tidak mengunci stok): tersedia = stok - dipesan.
 * excludeSo = SO yang tidak dihitung (mis. SO yang sedang dibuka, supaya terlihat "tersedia untuk SO ini").
 * -> Map skuId -> qty
 */
const committedQty = async (gudang, skuIds, { excludeSo = null } = {}) => {
  const ids = skuIds.filter((id) => mongoose.isValidObjectId(id)).map((id) => new mongoose.Types.ObjectId(String(id)));
  if (!ids.length || !mongoose.isValidObjectId(gudang)) return new Map();
  const match = { gudang: new mongoose.Types.ObjectId(String(gudang)), status: { $in: ['OPEN', 'PARTIAL'] }, 'lines.sku': { $in: ids } };
  if (excludeSo) match._id = { $ne: new mongoose.Types.ObjectId(String(excludeSo)) };
  const rows = await mongoose.model('SalesOrder').aggregate([
    { $match: match },
    { $unwind: '$lines' },
    { $match: { 'lines.sku': { $in: ids } } },
    {
      $group: {
        _id: '$lines.sku',
        qty: { $sum: { $max: [{ $subtract: ['$lines.qty', { $ifNull: ['$lines.qtyDelivered', 0] }] }, 0] } },
      },
    },
  ]);
  return new Map(rows.map((r) => [String(r._id), round2(r.qty)]));
};

/** Sisa SO OPEN / PARTIAL per SKU + gudang (semua gudang) -> Map "sku:gudang" -> qty (dipakai Reorder) */
const committedMap = async (skuIds) => {
  const ids = skuIds.filter((id) => mongoose.isValidObjectId(id)).map((id) => new mongoose.Types.ObjectId(String(id)));
  if (!ids.length) return new Map();
  const rows = await mongoose.model('SalesOrder').aggregate([
    { $match: { status: { $in: ['OPEN', 'PARTIAL'] }, 'lines.sku': { $in: ids } } },
    { $unwind: '$lines' },
    { $match: { 'lines.sku': { $in: ids } } },
    {
      $group: {
        _id: { sku: '$lines.sku', gudang: '$gudang' },
        qty: { $sum: { $max: [{ $subtract: ['$lines.qty', { $ifNull: ['$lines.qtyDelivered', 0] }] }, 0] } },
      },
    },
  ]);
  return new Map(rows.map((r) => [`${r._id.sku}:${r._id.gudang}`, round2(r.qty)]));
};

const toId = (id) => new mongoose.Types.ObjectId(String(id));
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

/**
 * Nilai SO yang BELUM ditagih (termasuk PPN): per baris qty yang masih akan ditagih x harga bersih,
 * dibagi proporsional seperti invoice (diskon dokumen & PPN), + ongkir jika belum ada invoice.
 * OPEN / PARTIAL: qty dipesan - sudah ditagih; DELIVERED / CLOSED: qty terkirim - sudah ditagih.
 * invoicedQty: Map skuId -> qty yang sudah ditagih (surat jalan ber-invoice); shippingBilled = ongkir sudah ditagih.
 */
const soUninvoicedValue = (so, invoicedQty, shippingBilled) => {
  const ratio = so.subtotal ? goodsTotal(so) / so.subtotal : 0;
  const goods = so.lines.reduce((sum, l) => {
    const target = ['OPEN', 'PARTIAL'].includes(so.status) ? l.qty : (l.qtyDelivered || 0);
    const qty = Math.max(target - (invoicedQty.get(String(l.sku)) || 0), 0);
    return sum + (l.qty ? (l.subtotal / l.qty) * qty * ratio : 0);
  }, 0);
  return round2(goods + (shippingBilled ? 0 : (so.shippingTotal || 0)));
};

/**
 * Posisi kredit customer:
 * - receivable : sisa tagihan invoice POSTED yang belum lunas (total - retur - dibayar)
 * - uninvoiced : nilai SO OPEN / PARTIAL + barang terkirim (SO DELIVERED / CLOSED) yang belum ditagih
 * - exposure   = receivable + uninvoiced;  available = limit - exposure (limit 0 = tanpa batas -> null)
 * - overdue    : invoice belum lunas yang lewat jatuh tempo { count, amount, oldestDueDate }
 * excludeSo = SO yang sedang dikonfirmasi (dihitung terpisah oleh pemanggil).
 */
const customerCredit = async (customerId, { excludeSo = null } = {}) => {
  const SalesOrder = mongoose.model('SalesOrder');
  const SalesInvoice = mongoose.model('SalesInvoice');
  const DeliveryOrder = mongoose.model('DeliveryOrder');
  const customer = await mongoose.model('Customer').findById(customerId).select('creditLimit').lean();
  const limit = round2(customer?.creditLimit || 0);
  const cid = toId(customerId);

  const unpaid = await SalesInvoice.find({ customer: cid, status: 'POSTED', paymentStatus: { $in: ['UNPAID', 'PARTIAL'] } })
    .select('total returnedAmount paidAmount dueDate').lean();
  const today = startOfToday();
  let receivable = 0;
  const overdue = { count: 0, amount: 0, oldestDueDate: null };
  unpaid.forEach((inv) => {
    const bal = round2((inv.total || 0) - (inv.returnedAmount || 0) - (inv.paidAmount || 0));
    if (bal <= 0) return;
    receivable += bal;
    if (inv.dueDate && inv.dueDate < today) {
      overdue.count += 1;
      overdue.amount += bal;
      if (!overdue.oldestDueDate || inv.dueDate < overdue.oldestDueDate) overdue.oldestDueDate = inv.dueDate;
    }
  });

  // SO aktif + SO selesai yang masih punya surat jalan belum ditagih
  const pendingDoSo = await DeliveryOrder.distinct('salesOrder', { customer: cid, status: 'POSTED', invoice: null });
  const soFilter = {
    customer: cid,
    $or: [{ status: { $in: ['OPEN', 'PARTIAL'] } }, { _id: { $in: pendingDoSo }, status: { $in: ['DELIVERED', 'CLOSED'] } }],
  };
  if (excludeSo) soFilter._id = { $ne: toId(excludeSo) };
  const orders = await SalesOrder.find(soFilter)
    .select('status lines.sku lines.qty lines.qtyDelivered lines.subtotal subtotal total shippingTotal').lean();
  let uninvoiced = 0;
  if (orders.length) {
    const soIds = orders.map((o) => o._id);
    // qty sudah ditagih per SO = surat jalan POSTED yang sudah punya invoice aktif
    const billed = await DeliveryOrder.find({ salesOrder: { $in: soIds }, status: 'POSTED', invoice: { $ne: null } })
      .select('salesOrder lines.sku lines.qty').lean();
    const bySo = new Map();
    billed.forEach((d) => {
      const key = String(d.salesOrder);
      const m = bySo.get(key) || new Map();
      d.lines.forEach((l) => m.set(String(l.sku), (m.get(String(l.sku)) || 0) + l.qty));
      bySo.set(key, m);
    });
    // ongkir sudah ditagih jika ada invoice aktif yang membebankan ongkir SO tsb
    const shipped = new Set((await SalesInvoice.find({ 'soAllocations.salesOrder': { $in: soIds }, status: { $ne: 'CANCELLED' } })
      .select('soAllocations').lean())
      .flatMap((inv) => inv.soAllocations.filter((a) => (a.shippingCharge || 0) > 0).map((a) => String(a.salesOrder))));
    orders.forEach((so) => {
      const key = String(so._id);
      uninvoiced += soUninvoicedValue(so, bySo.get(key) || new Map(), shipped.has(key));
    });
  }

  receivable = round2(receivable);
  uninvoiced = round2(uninvoiced);
  const exposure = round2(receivable + uninvoiced);
  return {
    limit,
    receivable,
    uninvoiced,
    exposure,
    available: limit > 0 ? round2(limit - exposure) : null,
    overdue: { ...overdue, amount: round2(overdue.amount) },
  };
};

module.exports = { committedQty, committedMap, customerCredit, soUninvoicedValue };
