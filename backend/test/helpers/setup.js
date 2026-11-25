/**
 * Kerangka test API: replica set sementara + app Express di port acak + helper request & data.
 *
 *   const { useTestApp } = require('../helpers/setup');
 *   const t = useTestApp();                         // pasang before/after untuk file ini
 *   test('...', async () => {
 *     const admin = await t.loginAs();               // Super Admin
 *     const res = await admin.post('/api/gudang', { code: 'MAIN', name: 'Main' });
 *     assert.equal(res.status, 201);
 *   });
 *
 * Setiap file test punya database sendiri (dikosongkan di awal file).
 */
const { before, after } = require('node:test');
const mongoose = require('mongoose');
require('../../helpers/transaction'); // aktifkan session otomatis sebelum query pertama
const { startReplSet } = require('./mongo');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const MODELS = [
  'User', 'Role', 'Menu', 'Kategori', 'Uom', 'Variant', 'Vendor', 'Produk', 'ProdukSku', 'VendorPrice',
  'AuditLog', 'TxLock', 'Counter', 'Gudang', 'StockBalance', 'StockMovement', 'StockAdjustment',
  'PurchaseOrder', 'GoodsReceipt', 'Setting', 'CostRevaluation', 'ReorderRule', 'StockTransfer',
  'Customer', 'SalesInvoice',
];

const model = (name) => mongoose.model(name);

function useTestApp() {
  const ctx = { baseUrl: null };
  let mongo;
  let server;

  before(async () => {
    mongo = await startReplSet();
    await mongoose.connect(mongo.uri);
    for (const name of MODELS) {
      let M;
      try { M = require(`../../models/${name}`); } catch { continue; } // model yang belum ada dilewati
      await M.createCollection().catch(() => {});
      await M.syncIndexes().catch(() => {});
    }
    const app = require('../../app');
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    ctx.baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
  });

  /** Request JSON -> { status, body, message, data } */
  const request = async (method, url, token, body) => {
    const res = await fetch(ctx.baseUrl + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json, message: json.message, data: json.data };
  };

  const client = (token) => ({
    token,
    get: (url, query) => request('GET', query ? `${url}?${new URLSearchParams(query)}` : url, token),
    post: (url, body = {}) => request('POST', url, token, body),
    put: (url, body = {}) => request('PUT', url, token, body),
    del: (url) => request('DELETE', url, token),
  });

  let seq = 0;
  /**
   * Buat user dengan role tertentu & kembalikan client ber-token. permissions = { produk: ['view', ...] } | 'admin'
   * opts.gudangs = [gudangId] -> akses hanya gudang tsb (allGudang false)
   */
  ctx.loginAs = async (permissions = 'admin', name, opts = {}) => {
    const Role = require('../../models/Role');
    const User = require('../../models/User');
    const generateToken = require('../../utils/generateToken');
    seq += 1;
    const role = permissions === 'admin'
      ? (await Role.findOne({ isSystem: true })) || (await Role.create({ name: 'Super Admin', isSystem: true }))
      : await Role.create({
        name: `Role ${seq}`,
        permissions: Object.entries(permissions).map(([resource, actions]) => ({ resource, actions: ['view', ...actions] })),
      });
    const access = opts.gudangs ? { allGudang: false, gudangs: opts.gudangs } : {};
    const user = await User.create({ name: name || `User ${seq}`, email: `user${seq}@test.com`, password: 'secret123', role: role._id, ...access });
    return { ...client(generateToken(user._id)), user };
  };
  ctx.anonymous = () => client(null);
  ctx.model = model;
  ctx.request = request;
  return ctx;
}

module.exports = { useTestApp, model };
