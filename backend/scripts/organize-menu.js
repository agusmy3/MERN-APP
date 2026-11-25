/**
 * Rapikan struktur menu sidebar ke susunan standar — aman dijalankan berulang kali (idempotent).
 *   cd backend && npm run menu:organize              -> DRY RUN: hanya tampilkan rencana
 *   cd backend && npm run menu:organize -- --apply   -> terapkan (backup JSON dulu di backups/)
 *
 * Susunan:
 *   Dashboard (/)
 *   Master Data : Category, Product, Variant, Unit of Measure, Vendor, Customer, Warehouse, Outlet
 *   Inventory   : Stock Adjustment, Stock Transfer, Stock Movement, Reorder, Stock Valuation, Cost Revaluation
 *   Purchasing  : Purchase Order, Goods Receipt
 *   Sales       : Sales Invoice, Sales Return, Sales Payment, Price List, Sales Report
 *   POS         : Cashier, POS Shift
 *   Settings    : User, Role, Menu, System Settings, Audit Log
 *
 * - Menu dicocokkan lewat route (`component`); yang ada dipindah (parent & order), nama/ikon tidak diubah.
 *   Menu target yang belum ada dibuat. Grup dicari lewat nama (termasuk nama lama, mis. "General" -> "Settings").
 * - Menu TANPA route yang tidak termasuk susunan (placeholder / grup yang jadi kosong) DIHAPUS.
 * - Menu dengan route lain (mis. halaman custom) tidak disentuh, hanya dilaporkan.
 * - Semua perubahan dalam 1 transaksi + audit log (1 batch).
 */
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const mongoose = require('mongoose');
const { runInTransaction } = require('../helpers/transaction');
const audit = require('../helpers/auditLogger');
const Menu = require('../models/Menu');
const User = require('../models/User');
require('../models/Role');

const APPLY = process.argv.includes('--apply');

const { MENU_TARGET: TARGET } = require('../config/menus');

const id = (v) => (v ? String(v) : null);

/** Rencana perubahan dari kondisi menu saat ini (murni, tanpa menulis). */
const plan = (menus) => {
  const byId = new Map(menus.map((m) => [id(m._id), m]));
  const byRoute = new Map(menus.filter((m) => m.component).map((m) => [m.component, m]));
  const actions = []; // { type: create|update|delete, ... }
  const keep = new Set();
  const pathOf = (m) => {
    const names = [];
    for (let cur = m; cur; cur = byId.get(id(cur.parent_id))) names.unshift(cur.menu);
    return names.join(' > ');
  };

  const place = (def, parentRef, order) => {
    const existing = byRoute.get(def.component);
    if (!existing) {
      actions.push({ type: 'create', def: { ...def, order }, parentRef });
      return;
    }
    keep.add(id(existing._id));
    const set = {};
    if (id(existing.parent_id) !== (parentRef.id ?? null) || parentRef.newGroup) set.parent_id = parentRef;
    if (existing.order !== order) set.order = order;
    if (!existing.resource && def.resource) set.resource = def.resource;
    if (Object.keys(set).length) actions.push({ type: 'update', menu: existing, set, from: pathOf(existing) });
  };

  for (const t of TARGET) {
    if (!t.group) {
      place(t, { id: null }, t.order);
      continue;
    }
    // grup: nama baru, lalu nama lama; utamakan grup yang sudah berisi anak target
    const names = [t.group, ...t.aliases];
    const candidates = menus.filter((m) => !m.component && names.includes(m.menu));
    const routes = new Set(t.children.map((c) => c.component));
    candidates.sort((a, b) => {
      const score = (g) => menus.filter((m) => id(m.parent_id) === id(g._id) && routes.has(m.component)).length;
      return score(b) - score(a) || names.indexOf(a.menu) - names.indexOf(b.menu);
    });
    const group = candidates[0];
    let ref;
    if (group) {
      keep.add(id(group._id));
      ref = { id: id(group._id) };
      const set = {};
      if (group.menu !== t.group) set.menu = t.group;
      if (group.parent_id) set.parent_id = { id: null };
      if (group.order !== t.order) set.order = t.order;
      if (!group.icon) set.icon = t.icon;
      if (Object.keys(set).length) actions.push({ type: 'update', menu: group, set, from: pathOf(group) });
    } else {
      ref = { newGroup: t.group };
      actions.push({ type: 'create', def: { menu: t.group, icon: t.icon, order: t.order, component: null }, parentRef: { id: null }, key: t.group });
    }
    t.children.forEach((c, i) => place(c, ref, i + 1));
  }

  // hapus: menu tanpa route yang tidak dipakai (placeholder / grup kosong), dari daun ke atas
  const moved = new Map(actions.filter((a) => a.type === 'update' && a.set.parent_id).map((a) => [id(a.menu._id), a.set.parent_id]));
  const parentAfter = (m) => (moved.has(id(m._id)) ? moved.get(id(m._id)).id ?? '__new__' : id(m.parent_id));
  const deleted = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of menus) {
      const mid = id(m._id);
      if (deleted.has(mid) || keep.has(mid) || m.component) continue;
      const hasChild = menus.some((c) => !deleted.has(id(c._id)) && parentAfter(c) === mid);
      if (!hasChild) {
        deleted.add(mid);
        actions.push({ type: 'delete', menu: m, from: pathOf(m) });
        changed = true;
      }
    }
  }

  const untouched = menus.filter((m) => m.component && !keep.has(id(m._id)) && !deleted.has(id(m._id)));
  return { actions, untouched, pathOf };
};

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const menus = await Menu.find().lean();
  const { actions, untouched, pathOf } = plan(menus);

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${menus.length} menu saat ini\n`);
  const describe = (a) => {
    if (a.type === 'create') return `[+] buat   ${a.def.menu}${a.def.component ? ` (${a.def.component})` : ' (grup)'}`;
    if (a.type === 'delete') return `[-] hapus  ${a.from}`;
    const parts = Object.entries(a.set).map(([k, v]) => {
      if (k === 'parent_id') return `pindah ke ${v.newGroup || (v.id ? menus.find((m) => id(m._id) === v.id)?.menu : 'root')}`;
      return `${k}=${v}`;
    });
    return `[~] ubah   ${a.from}: ${parts.join(', ')}`;
  };
  actions.forEach((a) => console.log(describe(a)));
  if (!actions.length) console.log('[=] Struktur menu sudah rapi, tidak ada perubahan');
  untouched.forEach((m) => console.log(`[i] dibiarkan: ${pathOf(m)} (${m.component})`));

  if (!APPLY) {
    console.log('\nJalankan dengan --apply untuk menerapkan.');
    return;
  }
  if (!actions.length) return;

  // backup seluruh menu sebelum diubah
  const dir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `menu-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(menus, null, 2));
  console.log(`\n[i] Backup: ${file}`);

  const admin = await User.findOne({ email: 'admin@mern.com' }).lean();
  const req = { user: admin ? { _id: admin._id, name: `${admin.name} (menu:organize)` } : null, headers: {}, ip: null };

  await runInTransaction(async () => {
    const batchId = audit.newBatchId();
    const newGroupIds = new Map();
    const now = new Date();

    for (const a of actions.filter((x) => x.type === 'create')) {
      const parentId = a.parentRef.newGroup ? newGroupIds.get(a.parentRef.newGroup) : a.parentRef.id;
      const doc = await Menu.create({
        menu: a.def.menu,
        component: a.def.component,
        icon: a.def.icon,
        resource: a.def.resource ?? null,
        deskripsi: a.def.deskripsi ?? null,
        order: a.def.order,
        parent_id: parentId ?? null,
        createdBy: admin?._id,
      });
      if (a.key) newGroupIds.set(a.key, String(doc._id));
      await audit.logCreate(req, 'menu', [doc], { batchId });
    }
    // anak dari grup baru dibuat setelah grupnya (create di atas berurutan sesuai TARGET)

    for (const a of actions.filter((x) => x.type === 'update')) {
      const doc = await Menu.findById(a.menu._id);
      const before = await audit.snap('menu', [doc]);
      for (const [k, v] of Object.entries(a.set)) {
        doc[k] = k === 'parent_id' ? (v.newGroup ? newGroupIds.get(v.newGroup) : v.id) : v;
      }
      doc.updatedDate = now;
      doc.updatedBy = admin?._id;
      await doc.save();
      await audit.logUpdate(req, 'menu', before, [doc], { batchId });
    }

    for (const a of actions.filter((x) => x.type === 'delete')) {
      const doc = await Menu.findById(a.menu._id);
      if (!doc) continue;
      const before = await audit.snap('menu', [doc]);
      await doc.deleteOne();
      await audit.logDelete(req, 'menu', before, { batchId });
    }
  });
  console.log(`[+] ${actions.length} perubahan diterapkan.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
