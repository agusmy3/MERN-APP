const mongoose = require('mongoose');
const DeliveryOrder = require('../models/DeliveryOrder');
const SalesOrder = require('../models/SalesOrder');
const SalesInvoice = require('../models/SalesInvoice');
const Customer = require('../models/Customer');
const Gudang = require('../models/Gudang');
const ProdukSku = require('../models/ProdukSku');
const { hasPermission } = require('../config/permissions');
const { successResponse, errorResponse } = require('../helpers/responseHelper');
const audit = require('../helpers/auditLogger');
const { runInTransaction, HttpError, lock, ref } = require('../helpers/transaction');
const { applyMovements, getBalances, nextDocNo } = require('../helpers/stockHelper');
const { checkAmount, round2 } = require('../helpers/number');
const { salesLineSubtotal, salesTotals, invoiceBalance, soOutstanding, deliveryStatus } = require('../helpers/salesHelper');
const { assertGudang, applyGudangFilter } = require('../helpers/gudangAccess');

const STATUSES = ['DRAFT', 'POSTED', 'CANCELLED'];
const SORTABLE_FIELDS = ['no', 'date', 'createdDate', 'updatedDate', 'postedDate'];
const DAY = 24 * 60 * 60 * 1000;

const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status);
  if (error.name === 'ValidationError' || error.name === 'CastError') return errorResponse(res, error.message, 400);
  return errorResponse(res, error.message, 500);
};

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const trimText = (v, max = 500) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));
const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
const canSeeCostOf = (req) => hasPermission(req.user, 'vendorPrice', 'view');
const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; };
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

/** Validasi isi DO dari body (murni). Baris dengan qty 0 diabaikan. */
const parseDo = (body) => {
  const date = body.date ? new Date(body.date) : new Date();
  if (Number.isNaN(date.getTime())) throw new HttpError('Invalid delivery date', 400);
  if (date > endOfToday()) throw new HttpError('Delivery date cannot be in the future', 400);

  const input = (Array.isArray(body.lines) ? body.lines : []).filter((l) => Number(l?.qty) !== 0);
  if (!input.length) throw new HttpError('Fill in the quantity to deliver for at least one item', 400);
  const seen = new Set();
  const lines = input.map((l, i) => {
    const n = `Line ${i + 1}`;
    if (!mongoose.isValidObjectId(l?.sku)) throw new HttpError(`${n}: invalid SKU`, 400);
    if (seen.has(String(l.sku))) throw new HttpError(`${n}: the same SKU appears more than once`, 400);
    seen.add(String(l.sku));
    const err = checkAmount(l.qty, 'Quantity', { min: 0, exclusive: true });
    if (err) throw new HttpError(`${n}: ${err}`, 400);
    return { sku: String(l.sku), qty: round2(l.qty), note: trimText(l.note, 200) || undefined };
  });

  return {
    date,
    vehicleNo: trimText(body.vehicleNo, 40),
    driverName: trimText(body.driverName, 120),
    courier: trimText(body.courier, 120),
    trackingNo: trimText(body.trackingNo, 100),
    pickedUpBy: trimText(body.pickedUpBy, 120),
    note: trimText(body.note),
    lines,
  };
};

/** SO yang bisa dikirim (OPEN / PARTIAL), dikunci: bentrok dengan cancel/close SO & DO lain */
const loadDeliverableSo = async (soId) => {
  if (!mongoose.isValidObjectId(soId)) throw new HttpError('Please select a sales order', 400);
  await lock(ref('salesOrder', soId));
  const so = await SalesOrder.findById(soId);
  if (!so) throw new HttpError('Sales order not found', 404);
  if (!['OPEN', 'PARTIAL'].includes(so.status)) {
    throw new HttpError(`${so.no} is ${so.status.toLowerCase()} and cannot be delivered`, 400);
  }
  return so;
};

const skuCodes = async (so) => {
  const rows = await ProdukSku.find({ _id: { $in: so.lines.map((l) => l.sku) } }).select('sku').lean();
  return new Map(rows.map((r) => [String(r._id), r.sku]));
};

/** Baris DO dari baris SO (qty <= sisa SO) */
const buildLines = (so, parsedLines, codes) => parsedLines.map((l) => {
  const soLine = so.lines.find((x) => String(x.sku) === l.sku);
  if (!soLine) throw new HttpError('One or more items do not belong to this sales order', 400);
  const outstanding = soOutstanding(soLine);
  if (l.qty > outstanding) {
    throw new HttpError(`${codes.get(l.sku) || 'Item'}: delivering ${fmt(l.qty)} exceeds the outstanding quantity ${fmt(outstanding)}`, 400);
  }
  return { sku: soLine.sku, produk: soLine.produk, qty: l.qty, unitCost: null, note: l.note };
});

const applyHeader = (doc, parsed, so) => {
  doc.date = parsed.date;
  doc.deliveryMethod = so.deliveryMethod;
  doc.shipTo = so.deliveryMethod === 'PICKUP' ? {} : (so.shipTo?.toObject ? so.shipTo.toObject() : so.shipTo);
  const delivery = so.deliveryMethod === 'DELIVERY';
  doc.vehicleNo = delivery ? parsed.vehicleNo : '';
  doc.driverName = delivery ? parsed.driverName : '';
  doc.courier = delivery ? parsed.courier : '';
  doc.trackingNo = delivery ? parsed.trackingNo : '';
  doc.pickedUpBy = delivery ? '' : parsed.pickedUpBy;
  doc.note = parsed.note;
};

const populateDo = (query) => query
  .populate('salesOrder', 'no status date customerPoNo requestedDate')
  .populate('customer', 'code name phone')
  .populate('gudang', 'code name alamat kota')
  .populate('invoice', 'no status total paymentStatus')
  .populate('lines.sku', 'sku variantValues isActive')
  .populate({ path: 'lines.produk', select: 'name uom', populate: { path: 'uom', select: 'code' } })
  .populate('createdBy', 'name')
  .populate('updatedBy', 'name')
  .populate('postedBy', 'name')
  .populate('cancelledBy', 'name');

const loadDoc = async (req, id) => {
  if (!mongoose.isValidObjectId(id)) throw new HttpError('Delivery order not found', 404);
  const doc = await DeliveryOrder.findById(id);
  if (!doc) throw new HttpError('Delivery order not found', 404);
  assertGudang(req, doc.gudang);
  return doc;
};

const loadDraft = async (req, id) => {
  const doc = await loadDoc(req, id);
  if (doc.status !== 'DRAFT') throw new HttpError(`Delivery order is already ${doc.status.toLowerCase()} and can no longer be changed`, 400);
  return doc;
};

// ---------------------------------------------------------------- baca

/**
 * GET /api/delivery-order — daftar (tanpa baris)
 * Query: search (no / no. SO / resi / customer), status, customer, salesOrder, gudang, invoiced (true|false), from, to
 * + lineCount, totalQty
 */
exports.getDeliveryOrders = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || 1) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || 10) || 10, 1), 100);
    const sortField = SORTABLE_FIELDS.includes(req.query.sortField) ? req.query.sortField : 'createdDate';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const filter = {};
    if (req.query.search) {
      const rx = { $regex: escapeRegex(req.query.search), $options: 'i' };
      const [soIds, customers] = await Promise.all([
        SalesOrder.find({ $or: [{ no: rx }, { customerPoNo: rx }] }).distinct('_id'),
        Customer.find({ $or: [{ name: rx }, { code: rx }] }).distinct('_id'),
      ]);
      filter.$or = [{ no: rx }, { trackingNo: rx }, { note: rx }, { salesOrder: { $in: soIds } }, { customer: { $in: customers } }];
    }
    if (STATUSES.includes(req.query.status)) filter.status = req.query.status;
    if (req.query.invoiced === 'false') { filter.status = 'POSTED'; filter.invoice = null; }
    if (req.query.invoiced === 'true') filter.invoice = { $ne: null };
    for (const key of ['customer', 'salesOrder']) {
      if (!req.query[key]) continue;
      if (!mongoose.isValidObjectId(req.query[key])) return errorResponse(res, `Invalid ${key}`, 400);
      filter[key] = req.query[key];
    }
    if (req.query.gudang && !mongoose.isValidObjectId(req.query.gudang)) return errorResponse(res, 'Invalid warehouse', 400);
    applyGudangFilter(req, filter, req.query.gudang);
    if (req.query.from || req.query.to) {
      filter.date = {};
      if (req.query.from) filter.date.$gte = new Date(`${req.query.from}T00:00:00`);
      if (req.query.to) filter.date.$lte = new Date(`${req.query.to}T23:59:59.999`);
      if (Object.values(filter.date).some((d) => Number.isNaN(d.getTime()))) return errorResponse(res, 'Invalid date', 400);
    }

    const [totalData, docs] = await Promise.all([
      DeliveryOrder.countDocuments(filter),
      DeliveryOrder.find(filter)
        .select('-lines')
        .populate('salesOrder', 'no')
        .populate('customer', 'code name')
        .populate('gudang', 'code name')
        .populate('invoice', 'no status')
        .populate('createdBy', 'name')
        .populate('updatedBy', 'name')
        .sort({ [sortField]: sortOrder, _id: sortOrder })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);
    const stats = await DeliveryOrder.aggregate([
      { $match: { _id: { $in: docs.map((d) => d._id) } } },
      { $project: { lineCount: { $size: '$lines' }, qty: { $sum: '$lines.qty' } } },
    ]);
    const statMap = new Map(stats.map((s) => [String(s._id), s]));
    docs.forEach((d) => {
      d.lineCount = statMap.get(String(d._id))?.lineCount || 0;
      d.totalQty = round2(statMap.get(String(d._id))?.qty || 0);
    });
    return successResponse(res, { dataDeliveryOrder: docs, totalData, currentPage: page, totalPages: Math.ceil(totalData / pageSize) });
  } catch (error) {
    return handleError(res, error);
  }
};

/** GET /api/delivery-order/so-options?search= — SO yang bisa dikirim (OPEN / PARTIAL), maks. 20 */
exports.getSoOptions = async (req, res) => {
  try {
    const filter = applyGudangFilter(req, { status: { $in: ['OPEN', 'PARTIAL'] } });
    if (req.query.search) {
      const rx = { $regex: escapeRegex(req.query.search), $options: 'i' };
      const customers = await Customer.find({ $or: [{ name: rx }, { code: rx }] }).distinct('_id');
      filter.$or = [{ no: rx }, { customerPoNo: rx }, { customer: { $in: customers } }];
    }
    const list = await SalesOrder.find(filter)
      .select('no date status customer gudang requestedDate deliveryMethod customerPoNo')
      .populate('customer', 'code name')
      .populate('gudang', 'code name')
      .sort({ requestedDate: 1, date: 1 })
      .limit(20)
      .lean();
    return successResponse(res, list);
  } catch (error) {
    return handleError(res, error);
  }
};

/** GET /api/delivery-order/from-so/:soId — data SO untuk mengisi DO: baris + sisa + stok gudang (tanpa harga) */
exports.getSoForDelivery = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.soId)) return errorResponse(res, 'Invalid sales order', 400);
    const so = await SalesOrder.findById(req.params.soId)
      .select('no date status customer gudang requestedDate customerPoNo deliveryMethod shipTo lines note')
      .populate('customer', 'code name phone')
      .populate('gudang', 'code name')
      .populate('lines.sku', 'sku variantValues')
      .populate({ path: 'lines.produk', select: 'name uom', populate: { path: 'uom', select: 'code' } })
      .lean();
    if (!so) return errorResponse(res, 'Sales order not found', 404);
    assertGudang(req, so.gudang?._id);
    const balances = await getBalances(so.gudang._id, so.lines.map((l) => l.sku?._id).filter(Boolean));
    so.lines.forEach((l) => {
      l.outstanding = soOutstanding(l);
      l.currentQty = l.sku ? balances.get(String(l.sku._id)) || 0 : 0;
      delete l.hargaJual;
      delete l.diskonPersen;
      delete l.subtotal;
    });
    return successResponse(res, so);
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * GET /api/delivery-order/:id — DO lengkap: + ordered/delivered/outstanding SO per baris, currentQty (draft),
 * shipTo; unitCost & nilai hanya vendorPrice:view; canInvoice (izin salesInvoice create + post).
 */
exports.getDeliveryOrder = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 'Delivery order not found', 404);
    const doc = await populateDo(DeliveryOrder.findById(req.params.id)).lean();
    if (!doc) return errorResponse(res, 'Delivery order not found', 404);
    assertGudang(req, doc.gudang?._id);
    const so = await SalesOrder.findById(doc.salesOrder?._id).select('lines').lean();
    const soLines = new Map((so?.lines || []).map((l) => [String(l.sku), l]));
    const balances = doc.status === 'DRAFT' ? await getBalances(doc.gudang._id, doc.lines.map((l) => l.sku?._id).filter(Boolean)) : null;
    const canSeeCost = canSeeCostOf(req);
    let value = 0;
    doc.lines.forEach((l) => {
      const sl = soLines.get(String(l.sku?._id ?? l.sku));
      l.ordered = sl?.qty ?? null;
      l.delivered = sl?.qtyDelivered ?? null;
      l.outstanding = sl ? soOutstanding(sl) : null;
      if (balances) l.currentQty = balances.get(String(l.sku?._id)) || 0;
      if (canSeeCost) value += l.qty * (l.unitCost || 0);
      else delete l.unitCost;
    });
    doc.canSeeCost = canSeeCost;
    if (canSeeCost && doc.status !== 'DRAFT') doc.totalValue = round2(value);
    doc.canInvoice = hasPermission(req.user, 'salesInvoice', 'create') && hasPermission(req.user, 'salesInvoice', 'post');
    return successResponse(res, doc);
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- draft

// POST /api/delivery-order  body: { salesOrder, date, vehicleNo, driverName, courier, trackingNo, pickedUpBy, note, lines: [{ sku, qty, note }], post? }
exports.createDeliveryOrder = async (req, res) => {
  try {
    const parsed = parseDo(req.body);
    const doc = await runInTransaction(async () => {
      const so = await loadDeliverableSo(req.body.salesOrder);
      assertGudang(req, so.gudang);
      const doc = new DeliveryOrder({
        no: await nextDocNo('DO'),
        salesOrder: so._id,
        customer: so.customer,
        gudang: so.gudang,
        status: 'DRAFT',
        createdBy: req.user._id,
      });
      applyHeader(doc, parsed, so);
      doc.lines = buildLines(so, parsed.lines, await skuCodes(so));
      await doc.save();
      await audit.logCreate(req, 'deliveryOrder', [doc]);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} saved as draft`, 201);
  } catch (error) {
    return handleError(res, error);
  }
};

// PUT /api/delivery-order/:id — ubah draft (SO tidak bisa diganti)
exports.updateDeliveryOrder = async (req, res) => {
  try {
    const doc = await runInTransaction(async () => {
      const doc = await loadDraft(req, req.params.id);
      const parsed = parseDo(req.body);
      const so = await loadDeliverableSo(doc.salesOrder);
      const before = await audit.snap('deliveryOrder', [doc]);
      applyHeader(doc, parsed, so);
      doc.lines = buildLines(so, parsed.lines, await skuCodes(so));
      doc.updatedDate = new Date();
      doc.updatedBy = req.user._id;
      await doc.save();
      await audit.logUpdate(req, 'deliveryOrder', before, [doc]);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} successfully updated`);
  } catch (error) {
    return handleError(res, error);
  }
};

// DELETE /api/delivery-order/:id — hanya draft
exports.deleteDeliveryOrder = async (req, res) => {
  try {
    const doc = await runInTransaction(async () => {
      const doc = await loadDoc(req, req.params.id);
      if (doc.status !== 'DRAFT') throw new HttpError('Only draft delivery orders can be deleted. Cancel a posted one instead.', 400);
      await lock(ref('salesOrder', doc.salesOrder));
      const before = await audit.snap('deliveryOrder', [doc]);
      await doc.deleteOne();
      await audit.logDelete(req, 'deliveryOrder', before);
      return doc;
    });
    return successResponse(res, doc, `${doc.no} successfully deleted`);
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- post / cancel (izin 'post')

/**
 * POST /api/delivery-order/:id/post — stok keluar (SALE) dari gudang SO, HPP saat itu per baris,
 * qtyDelivered & status SO diperbarui. Qty melebihi sisa SO / stok tidak cukup -> seluruh DO batal.
 */
exports.postDeliveryOrder = async (req, res) => {
  try {
    const doc = await runInTransaction(async () => {
      const doc = await loadDraft(req, req.params.id);
      const so = await loadDeliverableSo(doc.salesOrder);
      await lock(ref('gudang', doc.gudang));
      const gudang = await Gudang.findById(doc.gudang).select('code isActive').lean();
      if (!gudang) throw new HttpError('Warehouse no longer exists', 400);
      if (gudang.isActive === false) throw new HttpError(`Warehouse ${gudang.code} is inactive`, 400);

      const lines = buildLines(so, doc.lines.map((l) => ({ sku: String(l.sku), qty: l.qty, note: l.note })), await skuCodes(so));
      const batchId = audit.newBatchId();
      const before = await audit.snap('deliveryOrder', [doc]);
      const soBefore = await audit.snap('salesOrder', [so]);

      const movements = await applyMovements(req, lines.map((l) => ({
        sku: l.sku,
        gudang: doc.gudang,
        qty: -l.qty,
        type: 'SALE',
        note: [so.no, l.note].filter(Boolean).join(' · '),
      })), { refType: 'DeliveryOrder', refId: doc._id, refNo: doc.no });
      const costOf = new Map(movements.map((m) => [String(m.sku), m.unitCost ?? null]));
      lines.forEach((l) => { l.unitCost = costOf.get(String(l.sku)) ?? null; });

      for (const l of lines) {
        const sl = so.lines.find((x) => String(x.sku) === String(l.sku));
        sl.qtyDelivered = round2((sl.qtyDelivered || 0) + l.qty);
      }
      so.status = deliveryStatus(so.lines);
      await so.save();

      doc.lines = lines;
      doc.status = 'POSTED';
      doc.postedBy = req.user._id;
      doc.postedDate = new Date();
      await doc.save();
      await audit.logUpdate(req, 'deliveryOrder', before, [doc], { batchId });
      await audit.logUpdate(req, 'salesOrder', soBefore, [so], { batchId });
      return doc;
    });
    return successResponse(res, doc, `${doc.no} posted`);
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * POST /api/delivery-order/:id/cancel  body: { reason } — hanya POSTED yang belum ditagih:
 * barang kembali ke gudang (pembalik, HPP sama), qtyDelivered SO berkurang (SO CLOSED tetap CLOSED).
 */
exports.cancelDeliveryOrder = async (req, res) => {
  try {
    const reason = trimText(req.body.reason);
    if (!reason) return errorResponse(res, 'Cancellation reason is required', 400);
    const doc = await runInTransaction(async () => {
      const doc = await loadDoc(req, req.params.id);
      if (doc.status !== 'POSTED') {
        throw new HttpError(doc.status === 'DRAFT' ? 'Draft delivery orders are deleted, not cancelled' : 'Delivery order is already cancelled', 400);
      }
      await lock(ref('deliveryOrder', doc._id), ref('salesOrder', doc.salesOrder));
      const inv = await SalesInvoice.findOne({ deliveryOrder: doc._id, status: { $ne: 'CANCELLED' } }).select('no').lean();
      if (inv) throw new HttpError(`Delivery order is invoiced (${inv.no}). Cancel the invoice first.`, 400);
      const so = await SalesOrder.findById(doc.salesOrder);
      if (!so) throw new HttpError('Sales order no longer exists', 400);

      const batchId = audit.newBatchId();
      const before = await audit.snap('deliveryOrder', [doc]);
      const soBefore = await audit.snap('salesOrder', [so]);
      await applyMovements(req, doc.lines.map((l) => ({
        sku: l.sku,
        gudang: doc.gudang,
        qty: l.qty,
        unitCost: l.unitCost,
        type: 'SALE',
        note: `Cancelled: ${reason}`,
      })), { refType: 'DeliveryOrder', refId: doc._id, refNo: doc.no, isReversal: true });

      for (const l of doc.lines) {
        const sl = so.lines.find((x) => String(x.sku) === String(l.sku));
        if (sl) sl.qtyDelivered = Math.max(round2((sl.qtyDelivered || 0) - l.qty), 0);
      }
      if (so.status !== 'CLOSED') so.status = deliveryStatus(so.lines);
      await so.save();

      doc.status = 'CANCELLED';
      doc.invoice = null;
      doc.cancelReason = reason;
      doc.cancelledBy = req.user._id;
      doc.cancelledDate = new Date();
      await doc.save();
      await audit.logUpdate(req, 'deliveryOrder', before, [doc], { batchId });
      await audit.logUpdate(req, 'salesOrder', soBefore, [so], { batchId });
      return doc;
    });
    return successResponse(res, doc, `${doc.no} cancelled`);
  } catch (error) {
    return handleError(res, error);
  }
};

// ---------------------------------------------------------------- tagihan

/**
 * POST /api/delivery-order/:id/invoice  body: { date?, dueDate?, note? }
 * Buat Sales Invoice POSTED atas 1 DO POSTED yang belum ditagih (butuh salesInvoice create + post).
 * Tidak mengubah stok (stok sudah keluar di DO): baris = qty DO x harga & diskon SO, unitCost = HPP DO.
 * Diskon dokumen SO dibagi proporsional subtotal (invoice yang melengkapi SO memakai sisanya);
 * ongkir SO ditagih penuh di invoice pertama SO tsb (yang tidak dibatalkan). Jatuh tempo default = tanggal + termin customer.
 */
exports.createInvoice = async (req, res) => {
  try {
    if (!(hasPermission(req.user, 'salesInvoice', 'create') && hasPermission(req.user, 'salesInvoice', 'post'))) {
      return errorResponse(res, "You don't have permission to create and post sales invoices", 403);
    }
    const body = req.body || {};
    const date = body.date ? new Date(body.date) : new Date();
    if (Number.isNaN(date.getTime())) return errorResponse(res, 'Invalid invoice date', 400);
    if (date > endOfToday()) return errorResponse(res, 'Invoice date cannot be in the future', 400);
    let dueDate = null;
    if (body.dueDate) {
      dueDate = new Date(body.dueDate);
      if (Number.isNaN(dueDate.getTime())) return errorResponse(res, 'Invalid due date', 400);
      if (dueDate < startOfDay(date)) return errorResponse(res, 'Due date cannot be before the invoice date', 400);
    }

    const inv = await runInTransaction(async () => {
      const doc = await loadDoc(req, req.params.id);
      if (doc.status !== 'POSTED') throw new HttpError('Only posted delivery orders can be invoiced', 400);
      await lock(ref('deliveryOrder', doc._id), ref('salesOrder', doc.salesOrder));
      const existing = await SalesInvoice.findOne({ deliveryOrder: doc._id, status: { $ne: 'CANCELLED' } }).select('no').lean();
      if (existing) throw new HttpError(`Delivery order is already invoiced (${existing.no})`, 400);
      if (startOfDay(date) < startOfDay(doc.date)) throw new HttpError('Invoice date cannot be before the delivery date', 400);
      const so = await SalesOrder.findById(doc.salesOrder).lean();
      if (!so) throw new HttpError('Sales order no longer exists', 400);
      const customer = await Customer.findById(so.customer).select('termDays').lean();

      const soLine = new Map(so.lines.map((l) => [String(l.sku), l]));
      const lines = doc.lines.map((l) => {
        const sl = soLine.get(String(l.sku));
        if (!sl) throw new HttpError('Delivery line no longer matches the sales order', 400);
        const line = { sku: l.sku, produk: l.produk, qty: l.qty, hargaJual: sl.hargaJual, diskonPersen: sl.diskonPersen || 0, unitCost: l.unitCost, note: l.note };
        line.subtotal = salesLineSubtotal(line);
        return line;
      });
      const subtotal = round2(lines.reduce((s, l) => s + l.subtotal, 0));

      const prior = await SalesInvoice.find({ salesOrder: so._id, status: { $ne: 'CANCELLED' } }).select('discountAmount shippingCharge lines').lean();
      let discountAmount = 0;
      if (so.discountAmount > 0 && so.subtotal > 0) {
        const invoicedQty = new Map();
        [...prior.flatMap((p) => p.lines), ...lines].forEach((l) => invoicedQty.set(String(l.sku), round2((invoicedQty.get(String(l.sku)) || 0) + l.qty)));
        const completes = so.lines.every((l) => (invoicedQty.get(String(l.sku)) || 0) >= l.qty);
        discountAmount = completes
          ? round2(so.discountAmount - prior.reduce((s, p) => s + (p.discountAmount || 0), 0))
          : round2(so.discountAmount * (subtotal / so.subtotal));
        discountAmount = Math.min(Math.max(discountAmount, 0), subtotal);
      }
      const shippingCharge = prior.some((p) => (p.shippingCharge || 0) > 0) ? 0 : (so.shippingCharge || 0);

      const totals = salesTotals(lines, { discountAmount, taxRate: so.taxRate, priceIncludesTax: so.priceIncludesTax, shippingCharge });
      const now = new Date();
      const invDoc = new SalesInvoice({
        no: await nextDocNo('INV'),
        source: 'SALES_ORDER',
        salesOrder: so._id,
        deliveryOrder: doc._id,
        customer: so.customer,
        gudang: doc.gudang,
        date,
        dueDate: dueDate || new Date(startOfDay(date).getTime() + (customer?.termDays || 0) * DAY),
        status: 'POSTED',
        priceIncludesTax: so.priceIncludesTax,
        taxRate: so.taxRate,
        lines,
        ...totals,
        cogs: round2(lines.reduce((s, l) => s + l.qty * (l.unitCost || 0), 0)),
        returnedAmount: 0,
        paidAmount: 0,
        note: trimText(body.note) || [so.no, doc.no, so.customerPoNo ? `PO ${so.customerPoNo}` : ''].filter(Boolean).join(' · '),
        postedBy: req.user._id,
        postedDate: now,
        createdBy: req.user._id,
      });
      invDoc.paymentStatus = invoiceBalance(invDoc).paymentStatus;
      await invDoc.save();

      const batchId = audit.newBatchId();
      const before = await audit.snap('deliveryOrder', [doc]);
      doc.invoice = invDoc._id;
      await doc.save();
      await audit.logCreate(req, 'salesInvoice', [invDoc], { batchId });
      await audit.logUpdate(req, 'deliveryOrder', before, [doc], { batchId });
      return invDoc;
    });
    return successResponse(res, inv, `${inv.no} created`, 201);
  } catch (error) {
    return handleError(res, error);
  }
};
