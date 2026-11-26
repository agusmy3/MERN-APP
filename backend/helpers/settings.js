const Setting = require('../models/Setting');
const { SETTINGS, getDefinition } = require('../config/settings');
const { checkAmount, round2 } = require('./number');

/** Semua nilai setting (default untuk key yang belum disimpan): { 'tax.isPKP': true, ... } */
const getSettings = async () => {
  const rows = await Setting.find({ _id: { $in: SETTINGS.map((s) => s.key) } }).lean();
  const stored = new Map(rows.map((r) => [r._id, r.value]));
  return Object.fromEntries(SETTINGS.map((s) => [s.key, stored.has(s.key) ? stored.get(s.key) : s.default]));
};

/** Validasi & normalisasi 1 nilai sesuai definisinya. Throw Error berisi pesan untuk user. */
const normalizeSetting = (key, value) => {
  const def = getDefinition(key);
  if (!def) throw new Error(`Unknown setting: ${key}`);
  if (def.type === 'bool') {
    if (typeof value !== 'boolean') throw new Error(`${def.label} must be true or false`);
    return value;
  }
  if (def.type === 'number') {
    const err = checkAmount(value, def.label, { min: def.min ?? null });
    if (err) throw new Error(err);
    const n = round2(value);
    if (def.max !== undefined && n > def.max) throw new Error(`${def.label} must be <= ${def.max}`);
    return n;
  }
  const text = String(value ?? '').trim();
  if (def.required && !text) throw new Error(`${def.label} is required`);
  if (def.maxLength && text.length > def.maxLength) throw new Error(`${def.label} must be at most ${def.maxLength} characters`);
  return text;
};

module.exports = { getSettings, normalizeSetting };
