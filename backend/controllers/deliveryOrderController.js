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
  // baris: { soLine (id baris SO), qty (dalam satuan jual baris SO), note }; { sku } = baris SO satu-satunya untuk SKU tsb
  const lines = input.map((l, i) => {
    const n = `Line ${i + 1}`;
    if (l?.soLine ? !mongoose.isValidObjectId(l.soLine) : !mongoose.isValidObjectId(l?.sku)) throw new HttpError(`${n}: invalid sales order line`, 400);
    const err = checkAmount(l.qty, 'Quantity', { min: 0, exclusive: true });
    if (err) throw new HttpError(`${n}: ${err}`, 400);
    return { soLine: l.soLine ? String(l.soLine) : null, sku: l.sku ? String(l.sku) : null, qty: round2(l.qty), note: trimText(l.note, 200) || undefined };
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

/** Baris SO untuk baris DO: per id baris (soLine), atau per SKU untuk DO lama / input tanpa soLine (harus unik) */
const soLineOf = (so, l) => {
  if (l.soLine) return so.lines.find((x) => String(x._id) === String(l.soLine)) || null;
  const matches = so.lines.filter((x) => String(x.sku) === String(l.sku));
  if (matches.length > 1) throw new HttpError('This item appears in several units on the sales order: choose the order line', 400);
  return matches[0] || null;
};

/**
 * Baris DO dari baris SO: kemasan sama dengan SO, qty input dalam kemasan tsb (bulat untuk kemasan),
 * qty satuan dasar = qty x isi <= sisa SO. Baris SO unik per DO.
 */
const buildLines = (so, parsedLines, codes) => {
  const seen = new Set();
  return parsedLines.map((l) => {
    const soLine = soLineOf(so, l);
    if (!soLine) throw new HttpError('One or more items do not belong to this sales order', 400);
    if (seen.has(String(soLine._id))) throw new HttpError(`${codes.get(String(soLine.sku)) || 'Item'} appears more than once`, 400);
    seen.add(String(soLine._id));
    const konversi = soLine.konversi || 1;
    if (konversi > 1 && !Number.isInteger(l.qty)) throw new HttpError(`${codes.get(String(soLine.sku)) || 'Item'}: quantity must be a whole number of packages`, 400);
    const qty = round2(l.qty * konversi);
    const outstanding = soOutstanding(soLine);
    if (qty > outstanding) {
      throw new HttpError(`${codes.get(String(soLine.sku)) || 'Item'}: delivering ${fmt(l.qty)} exceeds the outstanding quantity ${fmt(round2(outstanding / konversi))}`, 400);
    }
    return {
      soLine: soLine._id, sku: soLine.sku, produk: soLine.produk, uom: soLine.uom || null, konversi, qtyUom: l.qty, qty, unitCost: null, note: l.note,
    };
  });
};

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
  .populate('lines.uom', 'code')
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
  .populate('lines.uom', 'code')
      .lean();
    if (!so) return errorResponse(res, 'Sales order not found', 404);
    assertGudang(req, so.gudang?._id);
    const balances = await getBalances(so.gudang._id, so.lines.map((l) => l.sku?._id).filter(Boolean));
    so.lines.forEach((l) => {
      // dalam satuan jual baris (kemasan); outstandingBase = satuan dasar
      l.outstandingBase = soOutstanding(l);
      l.outstanding = round2(l.outstandingBase / (l.konversi || 1));
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

    const balances = doc.status === 'DRAFT' ? await getBalances(doc.gudang._id, doc.lines.map((l) => l.sku?._id).filter(Boolean)) : null;
    const canSeeCost = canSeeCostOf(req);
    let value = 0;
    doc.lines.forEach((l) => {
      let sl = null;
      try { sl = so ? soLineOf(so, { soLine: l.soLine, sku: l.sku?._id ?? l.sku }) : null; } catch { sl = null; }
      // dalam satuan jual baris (kemasan)
      const k = l.konversi || 1;
      l.ordered = sl ? round2(sl.qty / k) : null;
      l.delivered = sl ? round2((sl.qtyDelivered || 0) / k) : null;
      l.outstanding = sl ? round2(soOutstanding(sl) / k) : null;
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

      const lines = buildLines(so, doc.lines.map((l) => ({ soLine: l.soLine, sku: String(l.sku), qty: l.qtyUom ?? l.qty, note: l.note })), await skuCodes(so));
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
        const sl = soLineOf(so, l);
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
      const inv = await SalesInvoice.findOne({ deliveryOrders: doc._id, status: { $ne: 'CANCELLED' } }).select('no').lean();
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
        let sl = null;
        try { sl = soLineOf(so, l); } catch { sl = null; }
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

/** Tanggal & jatuh tempo invoice dari body (murni) */
const parseInvoiceDates = (body) => {
  const date = body.date ? new Date(body.date) : new Date();
  if (Number.isNaN(date.getTime())) throw new HttpError('Invalid invoice date', 400);
  if (date > endOfToday()) throw new HttpError('Invoice date cannot be in the future', 400);
  let dueDate = null;
  if (body.dueDate) {
    dueDate = new Date(body.dueDate);
    if (Number.isNaN(dueDate.getTime())) throw new HttpError('Invalid due date', 400);
    if (dueDate < startOfDay(date)) throw new HttpError('Due date cannot be before the invoice date', 400);
  }
  return { date, dueDate };
};

const MAX_INVOICE_DOS = 50;

/**
 * Buat invoice POSTED dari 1 / beberapa DO POSTED yang belum ditagih (di dalam transaksi).
 * - Semua DO: customer & gudang sama; SO-nya: tarif PPN & mode harga sama.
 * - Baris digabung per SKU (harga & diskon harus sama; beda harga antar SO -> tagih terpisah); HPP dari DO.
 * - Per SO: diskon dokumen dibagi proporsional subtotal (invoice yang melengkapi qty SO memakai sisanya),
 *   ongkir SO ditagih penuh di invoice pertama SO tsb. Dicatat di soAllocations.
 * Stok tidak berubah (sudah keluar di DO).
 */
const invoiceDeliveries = async (req, ids, { date, dueDate, note }) => {
  const unique = [...new Set(ids.map(String))];
  const dos = await DeliveryOrder.find({ _id: { $in: unique } }).sort({ date: 1, no: 1 });
  if (dos.length !== unique.length) throw new HttpError('Delivery order not found', 404);
  dos.forEach((d) => assertGudang(req, d.gudang));
  const soIds = [...new Set(dos.map((d) => String(d.salesOrder)))];
  await lock(dos.map((d) => ref('deliveryOrder', d._id)), soIds.map((id) => ref('salesOrder', id)));

  for (const d of dos) {
    if (d.status !== 'POSTED') throw new HttpError(`${d.no}: only posted delivery orders can be invoiced`, 400);
    if (d.invoice) {
      const inv = await SalesInvoice.findById(d.invoice).select('no status').lean();
      if (inv && inv.status !== 'CANCELLED') throw new HttpError(`${d.no} is already invoiced (${inv.no})`, 400);
    }
    if (startOfDay(date) < startOfDay(d.date)) throw new HttpError(`Invoice date cannot be before the delivery date of ${d.no}`, 400);
  }
  if (new Set(dos.map((d) => String(d.customer))).size > 1) throw new HttpError('All delivery orders must be for the same customer', 400);
  if (new Set(dos.map((d) => String(d.gudang))).size > 1) throw new HttpError('All delivery orders must be from the same warehouse', 400);

  const orders = await SalesOrder.find({ _id: { $in: soIds } }).lean();
  if (orders.length !== soIds.length) throw new HttpError('Sales order no longer exists', 400);
  const first = orders[0];
  if (orders.some((o) => (o.taxRate || 0) !== (first.taxRate || 0) || !!o.priceIncludesTax !== !!first.priceIncludesTax)) {
    throw new HttpError('Sales orders have different tax settings (PPN rate / price incl. PPN). Invoice them separately.', 400);
  }
  const soById = new Map(orders.map((o) => [String(o._id), o]));

  // baris digabung per SKU + kemasan + harga + diskon (beda harga / kemasan = baris terpisah)
  const merged = new Map();
  for (const d of dos) {
    const so = soById.get(String(d.salesOrder));
    for (const l of d.lines) {
      let sl = null;
      try { sl = soLineOf(so, l); } catch { sl = null; }
      if (!sl) throw new HttpError(`${d.no}: delivery line no longer matches the sales order`, 400);
      const k = sl.konversi || 1;
      const key = [String(l.sku), k > 1 ? String(sl.uom) : '', sl.hargaJual, sl.diskonPersen || 0].join('|');
      const cur = merged.get(key);
      const qtyUom = round2(l.qty / k);
      if (cur) {
        cur.qty = round2(cur.qty + l.qty);
        cur.qtyUom = round2(cur.qtyUom + qtyUom);
        cur.cost += l.qty * (l.unitCost || 0);
        if (l.note && !cur.notes.includes(l.note)) cur.notes.push(l.note);
      } else {
        merged.set(key, {
          sku: l.sku, produk: l.produk, uom: sl.uom || null, konversi: k, qty: l.qty, qtyUom, hargaJual: sl.hargaJual, diskonPersen: sl.diskonPersen || 0,
          cost: l.qty * (l.unitCost || 0), notes: l.note ? [l.note] : [],
        });
      }
    }
  }
  const lines = [...merged.values()].map((m) => {
    const line = {
      sku: m.sku, produk: m.produk, uom: m.uom, konversi: m.konversi, qtyUom: m.qtyUom, qty: m.qty,
      hargaJual: m.hargaJual, diskonPersen: m.diskonPersen, note: m.notes.join('; ').slice(0, 200) || undefined,
    };
    line.subtotal = salesLineSubtotal(line);
    line.unitCost = m.qty ? round2(m.cost / m.qty) : 0;
    return line;
  });

  // alokasi per SO
  const allocations = [];
  for (const so of orders) {
    const soDos = dos.filter((d) => String(d.salesOrder) === String(so._id));
    const subtotal = round2(soDos.flatMap((d) => d.lines).reduce((sum, l) => {
      const sl = soLineOf(so, l);
      return sum + salesLineSubtotal({ qty: l.qty, qtyUom: round2(l.qty / (sl.konversi || 1)), hargaJual: sl.hargaJual, diskonPersen: sl.diskonPersen || 0 });
    }, 0));
    const prior = await SalesInvoice.find({ 'soAllocations.salesOrder': so._id, status: { $ne: 'CANCELLED' } }).select('soAllocations').lean();
    const priorAlloc = prior.flatMap((p) => p.soAllocations).filter((a) => String(a.salesOrder) === String(so._id));
    let discountAmount = 0;
    if (so.discountAmount > 0 && so.subtotal > 0) {
      // qty yang sudah / akan ditagih per SKU = DO SO ini yang sudah ditagih + DO di invoice ini
      const billed = await DeliveryOrder.find({ salesOrder: so._id, status: 'POSTED', invoice: { $ne: null }, _id: { $nin: soDos.map((d) => d._id) } })
        .select('lines.sku lines.soLine lines.qty').lean();
      // qty ditagih per baris SO
      const invoicedQty = new Map();
      [...billed.flatMap((d) => d.lines), ...soDos.flatMap((d) => d.lines)].forEach((l) => {
        let sl = null;
        try { sl = soLineOf(so, l); } catch { sl = null; }
        if (sl) invoicedQty.set(String(sl._id), round2((invoicedQty.get(String(sl._id)) || 0) + l.qty));
      });
      const completes = so.lines.every((l) => (invoicedQty.get(String(l._id)) || 0) >= l.qty);
      discountAmount = completes
        ? round2(so.discountAmount - priorAlloc.reduce((sum, a) => sum + (a.discountAmount || 0), 0))
        : round2(so.discountAmount * (subtotal / so.subtotal));
      discountAmount = Math.min(Math.max(discountAmount, 0), subtotal);
    }
    const shippingCharge = priorAlloc.some((a) => (a.shippingCharge || 0) > 0) ? 0 : (so.shippingCharge || 0);
    allocations.push({ salesOrder: so._id, subtotal, discountAmount, shippingCharge });
  }

  const totals = salesTotals(lines, {
    discountAmount: round2(allocations.reduce((sum, a) => sum + a.discountAmount, 0)),
    taxRate: first.taxRate,
    priceIncludesTax: first.priceIncludesTax,
    shippingCharge: round2(allocations.reduce((sum, a) => sum + a.shippingCharge, 0)),
  });
  const customer = await Customer.findById(dos[0].customer).select('termDays').lean();
  const now = new Date();
  const poNos = orders.map((o) => o.customerPoNo).filter(Boolean);
  const invDoc = new SalesInvoice({
    no: await nextDocNo('INV'),
    source: 'SALES_ORDER',
    salesOrders: orders.map((o) => o._id),
    deliveryOrders: dos.map((d) => d._id),
    soAllocations: allocations,
    customer: dos[0].customer,
    gudang: dos[0].gudang,
    date,
    dueDate: dueDate || new Date(startOfDay(date).getTime() + (customer?.termDays || 0) * DAY),
    status: 'POSTED',
    priceIncludesTax: first.priceIncludesTax,
    taxRate: first.taxRate,
    lines,
    ...totals,
    cogs: round2(dos.flatMap((d) => d.lines).reduce((sum, l) => sum + l.qty * (l.unitCost || 0), 0)),
    returnedAmount: 0,
    paidAmount: 0,
    note: trimText(note) || [orders.map((o) => o.no).join(', '), dos.map((d) => d.no).join(', '), poNos.length ? `PO ${poNos.join(', ')}` : '']
      .filter(Boolean).join(' · ').slice(0, 500),
    postedBy: req.user._id,
    postedDate: now,
    createdBy: req.user._id,
  });
  invDoc.paymentStatus = invoiceBalance(invDoc).paymentStatus;
  await invDoc.save();

  const batchId = audit.newBatchId();
  await audit.logCreate(req, 'salesInvoice', [invDoc], { batchId });
  for (const d of dos) {
    const before = await audit.snap('deliveryOrder', [d]);
    d.invoice = invDoc._id;
    await d.save();
    await audit.logUpdate(req, 'deliveryOrder', before, [d], { batchId });
  }
  return invDoc;
};

const assertInvoicePermission = (req) => {
  if (!(hasPermission(req.user, 'salesInvoice', 'create') && hasPermission(req.user, 'salesInvoice', 'post'))) {
    throw new HttpError("You don't have permission to create and post sales invoices", 403);
  }
};

/**
 * POST /api/delivery-order/:id/invoice  body: { date?, dueDate?, note? } — invoice POSTED atas 1 DO.
 * Butuh juga salesInvoice create + post. Aturan harga / diskon / ongkir: invoiceDeliveries.
 */
exports.createInvoice = async (req, res) => {
  try {
    assertInvoicePermission(req);
    const body = req.body || {};
    const dates = parseInvoiceDates(body);
    if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 'Delivery order not found', 404);
    const inv = await runInTransaction(() => invoiceDeliveries(req, [req.params.id], { ...dates, note: body.note }));
    return successResponse(res, inv, `${inv.no} created`, 201);
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * POST /api/delivery-order/invoice  body: { deliveryOrders: [id], date?, dueDate?, note? }
 * Invoice gabungan beberapa surat jalan (customer & gudang sama, boleh lintas SO).
 */
exports.createCombinedInvoice = async (req, res) => {
  try {
    assertInvoicePermission(req);
    const body = req.body || {};
    const ids = Array.isArray(body.deliveryOrders) ? body.deliveryOrders : [];
    if (!ids.length) return errorResponse(res, 'Select at least one delivery order', 400);
    if (ids.length > MAX_INVOICE_DOS) return errorResponse(res, `At most ${MAX_INVOICE_DOS} delivery orders per invoice`, 400);
    if (ids.some((id) => !mongoose.isValidObjectId(id))) return errorResponse(res, 'Invalid delivery order', 400);
    const dates = parseInvoiceDates(body);
    const inv = await runInTransaction(() => invoiceDeliveries(req, ids, { ...dates, note: body.note }));
    return successResponse(res, inv, `${inv.no} created for ${new Set(ids.map(String)).size} delivery order(s)`, 201);
  } catch (error) {
    return handleError(res, error);
  }
};
