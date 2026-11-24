const mongoose = require('mongoose');
const StockBalance = require('../models/StockBalance');
const Produk = require('../models/Produk');
const { successResponse, errorResponse } = require('../helpers/responseHelper');
const { round2 } = require('../helpers/number');

const GROUPS = ['sku', 'produk', 'kategori', 'gudang'];
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * GET /api/stock-valuation?groupBy=sku|produk|kategori|gudang&gudang=&kategori=&search=&includeZero=&missingOnly=
 * Nilai persediaan SAAT INI = saldo (StockBalance) x HPP rata-rata SKU (ProdukSku.avgCost).
 * Izin vendorPrice:view (HPP & nilai persediaan = data biaya, keputusan yang sama dengan harga beli).
 *
 * -> { groupBy, rows: [...], totals: { value, qty?, skuCount, missingCost, missingCostQty } }
 *    SKU berstok tanpa HPP (avgCost null) dihitung bernilai 0 dan ditandai missingCost.
 */
exports.getValuation = async (req, res) => {
  try {
    const groupBy = GROUPS.includes(req.query.groupBy) ? req.query.groupBy : 'sku';
    const filter = {};
    if (req.query.includeZero !== 'true') filter.qty = { $ne: 0 };
    if (req.query.gudang) {
      if (!mongoose.isValidObjectId(req.query.gudang)) return errorResponse(res, 'Invalid warehouse', 400);
      filter.gudang = req.query.gudang;
    }
    if (req.query.kategori || req.query.search) {
      const produkFilter = {};
      if (req.query.kategori) {
        if (!mongoose.isValidObjectId(req.query.kategori)) return errorResponse(res, 'Invalid category', 400);
        produkFilter.kategori = req.query.kategori;
      }
      if (req.query.search) {
        const rx = { $regex: escapeRegex(req.query.search), $options: 'i' };
        const skuMatch = await mongoose.model('ProdukSku').find({ sku: rx }).distinct('produk');
        produkFilter.$or = [{ name: rx }, { _id: { $in: skuMatch } }];
      }
      filter.produk = { $in: await Produk.find(produkFilter).distinct('_id') };
    }

    const balances = await StockBalance.find(filter)
      .select('sku produk gudang qty')
      .populate('sku', 'sku variantValues avgCost isActive')
      .populate({
        path: 'produk',
        select: 'name kategori uom',
        populate: [{ path: 'kategori', select: 'name' }, { path: 'uom', select: 'code' }],
      })
      .populate('gudang', 'code name')
      .lean();

    // search juga menyaring per SKU (produk cocok karena 1 SKU-nya cocok -> tampilkan SKU yang cocok saja)
    const q = String(req.query.search || '').trim().toLowerCase();
    const rows0 = balances
      .filter((b) => b.sku && b.produk)
      .filter((b) => !q || b.sku.sku.toLowerCase().includes(q) || b.produk.name.toLowerCase().includes(q))
      .map((b) => {
        const avgCost = b.sku.avgCost ?? null;
        return {
          sku: b.sku,
          produk: b.produk,
          gudang: b.gudang,
          qty: b.qty,
          avgCost,
          value: avgCost === null ? 0 : round2(b.qty * avgCost),
          missingCost: avgCost === null && b.qty !== 0,
        };
      });

    // hanya baris berstok tanpa HPP (untuk dilengkapi lewat Cost Revaluation)
    if (req.query.missingOnly === 'true') {
      for (let i = rows0.length - 1; i >= 0; i--) if (!rows0[i].missingCost) rows0.splice(i, 1);
    }

    const groups = new Map();
    const keyOf = {
      sku: (r) => String(r.sku._id),
      produk: (r) => String(r.produk._id),
      kategori: (r) => String(r.produk.kategori?._id || 'none'),
      gudang: (r) => String(r.gudang?._id || 'none'),
    }[groupBy];

    for (const r of rows0) {
      const key = keyOf(r);
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          value: 0,
          qty: 0,
          skus: new Set(),
          produks: new Set(),
          missingCost: new Set(),
          // identitas grup
          ...(groupBy === 'sku' && {
            sku: { _id: r.sku._id, sku: r.sku.sku, variantValues: r.sku.variantValues, isActive: r.sku.isActive },
            produk: { _id: r.produk._id, name: r.produk.name },
            kategori: r.produk.kategori?.name || '-',
            uom: r.produk.uom?.code || '',
            avgCost: r.avgCost,
          }),
          ...(groupBy === 'produk' && {
            produk: { _id: r.produk._id, name: r.produk.name },
            kategori: r.produk.kategori?.name || '-',
            uom: r.produk.uom?.code || '',
          }),
          ...(groupBy === 'kategori' && { kategori: r.produk.kategori ? { _id: r.produk.kategori._id, name: r.produk.kategori.name } : { name: '(no category)' } }),
          ...(groupBy === 'gudang' && { gudang: r.gudang ? { _id: r.gudang._id, code: r.gudang.code, name: r.gudang.name } : { code: '?' } }),
        });
      }
      const g = groups.get(key);
      g.value = round2(g.value + r.value);
      g.qty = round2(g.qty + r.qty);
      g.skus.add(String(r.sku._id));
      g.produks.add(String(r.produk._id));
      if (r.missingCost) g.missingCost.add(String(r.sku._id));
    }

    // qty hanya bermakna jika satuannya sama (per SKU / per produk)
    const sameUnit = groupBy === 'sku' || groupBy === 'produk';
    const rows = [...groups.values()]
      .map(({ skus, produks, missingCost, ...g }) => ({
        ...g,
        qty: sameUnit ? g.qty : undefined,
        skuCount: skus.size,
        produkCount: produks.size,
        missingCost: missingCost.size,
      }))
      .sort((a, b) => b.value - a.value);

    const missing = rows0.filter((r) => r.missingCost);
    const totals = {
      value: round2(rows0.reduce((sum, r) => sum + r.value, 0)),
      skuCount: new Set(rows0.map((r) => String(r.sku._id))).size,
      missingCost: new Set(missing.map((r) => String(r.sku._id))).size,
    };
    rows.forEach((r) => { r.share = totals.value ? round2((r.value / totals.value) * 100) : 0; });

    return successResponse(res, { groupBy, rows, totals });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};
