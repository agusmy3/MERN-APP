const { successResponse, errorResponse } = require('./responseHelper');

/**
 * Handler GET /dropdown: daftar ringkas untuk pilihan di form (select).
 * Hanya field yang disebut di `fields` yang dikirim (umumnya _id & name), tanpa audit/data sensitif.
 * Cukup butuh login (protect), tidak butuh izin 'view' resource tsb — supaya mis. user dengan
 * izin produk:create tetap bisa memilih kategori.
 */
const dropdownHandler = (Model, fields, sort) => async (req, res) => {
  try {
    const data = await Model.find().select(fields).sort(sort).lean();
    return successResponse(res, data);
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
};

module.exports = { dropdownHandler };
