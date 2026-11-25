const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const PriceList = require('../models/PriceList');
const ProdukSku = require('../models/ProdukSku');

/**
 * Harga jual per SKU untuk customer: price list customer (jika aktif & SKU ada di list) atau hargaJual SKU.
 * -> Map skuId -> { price, source: 'list' | 'default', priceList?: { _id, code, name } }
 */
const resolvePrices = async (customerId, skuIds) => {
  const ids = skuIds.filter((id) => mongoose.isValidObjectId(id)).map(String);
  const skus = await ProdukSku.find({ _id: { $in: ids } }).select('hargaJual').lean();
  const out = new Map(skus.map((s) => [String(s._id), { price: s.hargaJual ?? 0, source: 'default' }]));

  if (!customerId || !mongoose.isValidObjectId(customerId)) return out;
  const customer = await Customer.findById(customerId).select('priceList').lean();
  if (!customer?.priceList) return out;
  const list = await PriceList.findOne({ _id: customer.priceList, isActive: true }).select('code name items').lean();
  if (!list) return out;
  const meta = { _id: list._id, code: list.code, name: list.name };
  for (const item of list.items) {
    const key = String(item.sku);
    if (out.has(key)) out.set(key, { price: item.price, source: 'list', priceList: meta });
  }
  return out;
};

module.exports = { resolvePrices };
