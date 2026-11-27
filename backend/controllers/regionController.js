const Region = require('../models/Region');
const { successResponse, errorResponse } = require('../helpers/responseHelper');
const { CODE_RX, regionPath, centerOf, toItem } = require('../helpers/regionHelper');

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const searchText = (v) => String(v ?? '').trim().slice(0, 60);

/**
 * GET /api/region?parent=&search= : anak dari `parent` (kosong = daftar provinsi), urut nama.
 * Untuk dropdown berantai Provinsi -> Kota/Kab -> Kecamatan -> Kelurahan. Wilayah nonaktif tidak ditampilkan.
 */
exports.listRegions = async (req, res) => {
  try {
    const parent = String(req.query.parent ?? '').trim();
    if (parent && !CODE_RX.test(parent)) return errorResponse(res, 'Invalid region code', 400);
    const filter = { parent: parent || null, isActive: true };
    const search = searchText(req.query.search);
    if (search) filter.name = { $regex: escapeRx(search), $options: 'i' };
    const list = await Region.find(filter).sort({ name: 1 }).collation({ locale: 'en', strength: 2 }).lean();
    return successResponse(res, list.map(toItem));
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * GET /api/region/search?q=&level=&limit= : cari nama wilayah di semua tingkat (atau 1 tingkat),
 * hasil + `path` (rantai nama) supaya bisa dibedakan, mis. "Sukajadi, Kota Bandung, Jawa Barat".
 */
exports.searchRegions = async (req, res) => {
  try {
    const q = searchText(req.query.q);
    if (q.length < 3) return errorResponse(res, 'Type at least 3 characters to search', 400);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const filter = { name: { $regex: escapeRx(q), $options: 'i' }, isActive: true };
    if (req.query.level) {
      const level = Number(req.query.level);
      if (![1, 2, 3, 4].includes(level)) return errorResponse(res, 'Level must be 1-4', 400);
      filter.level = level;
    }
    // nama yang diawali kata kunci lebih dulu, lalu tingkat yang lebih tinggi
    const found = await Region.find(filter).sort({ level: 1, name: 1 }).limit(500).lean();
    const starts = new RegExp(`^${escapeRx(q)}`, 'i');
    found.sort((a, b) => (starts.test(b.name) - starts.test(a.name)) || (a.level - b.level) || a.name.localeCompare(b.name));
    const hits = found.slice(0, limit);

    const ancestorIds = new Set();
    hits.forEach((r) => { let p = r.parent; while (p) { ancestorIds.add(p); p = p.includes('.') ? p.slice(0, p.lastIndexOf('.')) : null; } });
    const names = new Map((await Region.find({ _id: { $in: [...ancestorIds] } }).select('name').lean()).map((r) => [r._id, r.name]));
    const data = hits.map((r) => {
      const chain = [];
      let p = r.parent;
      while (p) { chain.push(names.get(p)); p = p.includes('.') ? p.slice(0, p.lastIndexOf('.')) : null; }
      return { ...toItem(r), path: [r.name, ...chain.filter(Boolean)].join(', ') };
    });
    return successResponse(res, data);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

/**
 * GET /api/region/:kode : wilayah + `path` (provinsi -> wilayah ini) + `center` (titik awal peta:
 * koordinat wilayah ini atau leluhur terdekat; data hanya sampai kab/kota).
 */
exports.getRegion = async (req, res) => {
  try {
    const kode = String(req.params.kode).trim();
    if (!CODE_RX.test(kode)) return errorResponse(res, 'Invalid region code', 400);
    const chain = await regionPath(kode);
    const self = chain[chain.length - 1];
    if (!self || self._id !== kode) return errorResponse(res, 'Region not found', 404);
    return successResponse(res, { ...toItem(self), path: chain.map(toItem), center: centerOf(chain) });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};
