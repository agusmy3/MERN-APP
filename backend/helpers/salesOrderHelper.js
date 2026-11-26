const mongoose = require('mongoose');
const { round2 } = require('./number');

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

module.exports = { committedQty };
