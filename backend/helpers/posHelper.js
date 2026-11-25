const mongoose = require('mongoose');
const SalesInvoice = require('../models/SalesInvoice');
const SalesPayment = require('../models/SalesPayment');
const SalesReturn = require('../models/SalesReturn');
const { HttpError } = require('./transaction');
const { round2 } = require('./number');

/** Outlet POS yang boleh dipakai user: Super Admin semua, selain itu User.outlets */
const canUseOutlet = (req, outletId) => {
  if (req.user?.role?.isSystem) return true;
  return (req.user?.outlets || []).some((id) => String(id?._id ?? id) === String(outletId));
};

const assertOutlet = (req, outletId) => {
  if (!canUseOutlet(req, outletId)) throw new HttpError("You are not assigned to this outlet", 403);
};

/**
 * Ringkasan shift dari data: penjualan (invoice POSTED), pembayaran per metode (PAYMENT - REFUND,
 * POSTED), kas masuk/keluar, dan kas seharusnya di laci:
 *   expectedCash = openingCash + tunai - refund tunai + kas masuk - kas keluar
 */
const shiftSummary = async (shift) => {
  const id = new mongoose.Types.ObjectId(String(shift._id));
  const [sales, pays, voids, returns] = await Promise.all([
    SalesInvoice.aggregate([
      { $match: { shift: id, status: 'POSTED' } },
      { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$total' }, dpp: { $sum: '$dpp' } } },
    ]),
    SalesPayment.aggregate([
      { $match: { shift: id, status: 'POSTED' } },
      { $group: { _id: '$method', net: { $sum: { $cond: [{ $eq: ['$type', 'REFUND'] }, { $multiply: ['$amount', -1] }, '$amount'] } } } },
    ]),
    SalesInvoice.aggregate([
      { $match: { shift: id, status: 'CANCELLED', voidApprovedBy: { $ne: null } } },
      { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$total' } } },
    ]),
    SalesReturn.aggregate([
      { $match: { shift: id, status: 'POSTED' } },
      { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$total' } } },
    ]),
  ]);
  const byMethod = Object.fromEntries(pays.map((p) => [p._id, round2(p.net)]));
  const cashIn = round2((shift.cashMoves || []).filter((m) => m.type === 'IN').reduce((s, m) => s + m.amount, 0));
  const cashOut = round2((shift.cashMoves || []).filter((m) => m.type === 'OUT').reduce((s, m) => s + m.amount, 0));
  const cash = byMethod.CASH || 0;
  return {
    salesCount: sales[0]?.count || 0,
    salesTotal: round2(sales[0]?.total || 0),
    netSales: round2(sales[0]?.dpp || 0),
    byMethod,
    voidCount: voids[0]?.count || 0,
    voidTotal: round2(voids[0]?.total || 0),
    returnCount: returns[0]?.count || 0,
    returnTotal: round2(returns[0]?.total || 0),
    cashIn,
    cashOut,
    expectedCash: round2((shift.openingCash || 0) + cash + cashIn - cashOut),
  };
};

module.exports = { canUseOutlet, assertOutlet, shiftSummary };
