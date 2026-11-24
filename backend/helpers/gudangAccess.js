/**
 * Akses gudang per user (User.allGudang / User.gudangs). Dipakai SETELAH protect (req.user terisi).
 *
 *   gudangScope(req)              -> null (semua gudang) | ['<id>', ...] (gudang yang ditugaskan)
 *   assertGudang(req, id)         -> throw HttpError 403 jika gudang di luar akses
 *   gudangFilter(req, requested)  -> nilai untuk filter.gudang di query daftar:
 *                                    undefined (tanpa filter) | id yang diminta (dicek) | { $in: scope }
 *
 * Super Admin & user dengan allGudang (default, termasuk user lama tanpa field) = semua gudang.
 * Aturan (keputusan): dokumen, kartu stok, nilai persediaan, reorder & dashboard dibatasi ke gudang
 * yang ditugaskan; JUMLAH stok gudang lain (tanpa nilai) tetap boleh dilihat (tab Stock produk).
 */
const mongoose = require('mongoose');
const { HttpError } = require('./transaction');

const gudangScope = (req) => {
  const u = req.user;
  if (!u) return [];
  if (u.role?.isSystem || u.allGudang !== false) return null;
  return (u.gudangs || []).map((g) => String(g?._id ?? g));
};

const canAccessGudang = (req, id) => {
  const scope = gudangScope(req);
  return !scope || scope.includes(String(id?._id ?? id));
};

const NO_ACCESS = "You don't have access to this warehouse";

const assertGudang = (req, ...ids) => {
  for (const id of ids.flat()) {
    if (id && !canAccessGudang(req, id)) throw new HttpError(NO_ACCESS, 403);
  }
};

const toIds = (list) => list.map((id) => new mongoose.Types.ObjectId(String(id)));

/**
 * Filter gudang untuk query daftar. `requested` = req.query.gudang (opsional).
 * `asObjectId` untuk pipeline aggregate (find() mengubah string otomatis, aggregate tidak).
 */
const gudangFilter = (req, requested, { asObjectId = false } = {}) => {
  if (requested) {
    if (!mongoose.isValidObjectId(requested)) throw new HttpError('Invalid warehouse', 400);
    assertGudang(req, requested);
    return asObjectId ? new mongoose.Types.ObjectId(String(requested)) : String(requested);
  }
  const scope = gudangScope(req);
  if (!scope) return undefined;
  return { $in: asObjectId ? toIds(scope) : scope };
};

/** Pasang filter gudang ke objek filter (field bisa selain 'gudang', mis. 'fromGudang') */
const applyGudangFilter = (req, filter, requested, field = 'gudang', opts) => {
  const value = gudangFilter(req, requested, opts);
  if (value !== undefined) filter[field] = value;
  return filter;
};

module.exports = { gudangScope, canAccessGudang, assertGudang, gudangFilter, applyGudangFilter, NO_ACCESS };
