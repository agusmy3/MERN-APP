const Setting = require('../models/Setting');
const { successResponse, errorResponse } = require('../helpers/responseHelper');
const { SETTINGS } = require('../config/settings');
const { getSettings, normalizeSetting } = require('../helpers/settings');
const audit = require('../helpers/auditLogger');
const { runInTransaction, HttpError } = require('../helpers/transaction');

const handleError = (res, error) => {
  if (error instanceof HttpError) return errorResponse(res, error.message, error.status);
  return errorResponse(res, error.message, 500);
};

// GET /api/setting — definisi + nilai (cukup login: form lain butuh mis. tarif PPN default)
exports.getSettings = async (req, res) => {
  try {
    return successResponse(res, { definitions: SETTINGS, values: await getSettings() });
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * PUT /api/setting  body: { values: { 'tax.ppnRate': 11, ... } } (izin setting:update)
 * Hanya key yang dikirim yang diubah. Setiap key yang berubah dicatat di audit log.
 */
exports.updateSettings = async (req, res) => {
  try {
    const input = req.body?.values && typeof req.body.values === 'object' ? req.body.values : {};
    const updates = {};
    for (const [key, value] of Object.entries(input)) {
      try {
        updates[key] = normalizeSetting(key, value);
      } catch (err) {
        return errorResponse(res, err.message, 400);
      }
    }
    if (!Object.keys(updates).length) return errorResponse(res, 'No setting to update', 400);

    await runInTransaction(async () => {
      const current = await getSettings();
      // dokumen yang belum pernah disimpan diperlakukan sebagai nilai default
      const beforeDocs = Object.keys(updates).map((key) => ({ _id: key, value: current[key] }));
      const before = await audit.snap('setting', beforeDocs);
      const now = new Date();
      for (const [key, value] of Object.entries(updates)) {
        await Setting.updateOne({ _id: key }, { $set: { value, updatedDate: now, updatedBy: req.user._id } }, { upsert: true });
      }
      const after = await Setting.find({ _id: { $in: Object.keys(updates) } }).lean();
      await audit.logUpdate(req, 'setting', before, after);
    });

    return successResponse(res, await getSettings(), 'Settings successfully saved');
  } catch (error) {
    return handleError(res, error);
  }
};
