/**
 * Audit log eksplisit: dipanggil dari controller DI DALAM runInTransaction (helpers/transaction.js),
 * setelah perubahan ditulis. Log ikut transaksi: data & log berhasil atau batal BERSAMA.
 *
 *   const before = await audit.snap('vendorPrice', [price]);   // sebelum diubah
 *   ... ubah & simpan ...
 *   await audit.logUpdate(req, 'vendorPrice', before, [price], { batchId });
 *   await audit.logCreate(req, 'produkSku', docs, { batchId });
 *   await audit.logDelete(req, 'vendorPrice', docs, { batchId });
 *
 * Gagal menulis log -> error di-throw -> transaksi (dan perubahan datanya) dibatalkan.
 * Pengecualian: logLogin (di luar transaksi; login tetap jalan walau log gagal).
 * Entity baru: tambahkan definisinya di ENTITIES.
 */
const crypto = require('crypto');
const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');
const { getResourceLabel } = require('../config/permissions');
const { ADJUSTMENT_TYPES, REASONS } = require('../config/stock');
const { getDefinition: getSettingDefinition } = require('../config/settings');

// model diambil lewat nama (lazy) supaya tidak terjadi circular require
const model = (name) => mongoose.model(name);

/**
 * Definisi per entity:
 * - fields : field yang dicatat -> { label, format?, ref?: [modelName, textField], secret?, labels? }
 *            labels = peta kode -> teks (mis. alasan penyesuaian); format 'stockLines' = baris dokumen stok
 * - label  : teks pengenal record (disimpan, tetap terbaca walau record dihapus)
 * - parent : induk record untuk histori gabungan
 */
const ENTITIES = {
  produk: {
    fields: {
      name: { label: 'Name' },
      kategori: { label: 'Category', ref: ['Kategori', 'name'] },
      uom: { label: 'Base UoM', ref: ['Uom', 'code'] },
      variants: { label: 'Variant Types', ref: ['Variant', 'code'] },
      deskripsi: { label: 'Description' },
    },
    label: (doc) => doc.name,
  },
  produkSku: {
    fields: {
      sku: { label: 'SKU Code' },
      variantValues: { label: 'Variant', format: 'variantValues' },
      hargaJual: { label: 'Selling Price', format: 'money' },
      barcode: { label: 'Barcode' },
      isActive: { label: 'Active', format: 'bool' },
    },
    label: (doc) => doc.sku,
    parent: (doc) => ({ entity: 'produk', id: doc.produk?._id ?? doc.produk }),
  },
  vendorPrice: {
    fields: {
      vendor: { label: 'Vendor', ref: ['Vendor', 'companyName'] },
      sku: { label: 'SKU', ref: ['ProdukSku', 'sku'] },
      uomBeli: { label: 'Purchase UoM', ref: ['Uom', 'code'] },
      konversi: { label: 'Conversion', format: 'number' },
      hargaBeli: { label: 'Purchase Price', format: 'money' },
      isPreferred: { label: 'Preferred', format: 'bool' },
      minOrder: { label: 'Min. Order', format: 'number' },
      catatan: { label: 'Notes' },
    },
    label: (doc, flat) => `${flat.vendor?.text || '?'} · ${flat.sku?.text || '?'}`,
    parent: (doc) => ({ entity: 'produk', id: doc.produk?._id ?? doc.produk }),
  },
  role: {
    fields: {
      name: { label: 'Name' },
      deskripsi: { label: 'Description' },
      permissions: { label: 'Permission', format: 'permissions' },
    },
    label: (doc) => doc.name,
  },
  user: {
    fields: {
      name: { label: 'Name' },
      email: { label: 'Email' },
      role: { label: 'Role', ref: ['Role', 'name'] },
      isActive: { label: 'Active', format: 'bool' },
      allGudang: { label: 'All Warehouses', format: 'bool' },
      gudangs: { label: 'Warehouses', ref: ['Gudang', 'code'] },
      outlets: { label: 'POS Outlets', ref: ['Outlet', 'code'] },
      password: { label: 'Password', secret: true },
    },
    label: (doc) => `${doc.name} (${doc.email})`,
  },

  // ---------- fase 2: master data ----------
  kategori: {
    fields: {
      name: { label: 'Name' },
      deskripsi: { label: 'Description' },
    },
    label: (doc) => doc.name,
  },
  vendor: {
    fields: {
      companyName: { label: 'Company Name' },
      picName: { label: 'PIC Name' },
      picContact: { label: 'PIC Contact' },
      companyAddress: { label: 'Company Address' },
    },
    label: (doc) => doc.companyName,
  },
  uom: {
    fields: {
      code: { label: 'Code' },
      name: { label: 'Name' },
      type: { label: 'Type', labels: require('../config/uom').UOM_TYPES },
      deskripsi: { label: 'Description' },
    },
    label: (doc) => `${doc.code} — ${doc.name}`,
  },
  variant: {
    fields: {
      code: { label: 'Code' },
      name: { label: 'Name' },
      values: { label: 'Values', format: 'list' },
      deskripsi: { label: 'Description' },
    },
    label: (doc) => `${doc.code} — ${doc.name}`,
  },
  gudang: {
    fields: {
      code: { label: 'Code' },
      name: { label: 'Name' },
      alamat: { label: 'Address' },
      provinsi: { label: 'Province' },
      kota: { label: 'City / Regency' },
      kecamatan: { label: 'District' },
      kodePos: { label: 'Postal Code' },
      latitude: { label: 'Latitude', format: 'coord' },
      longitude: { label: 'Longitude', format: 'coord' },
      deskripsi: { label: 'Description' },
      isActive: { label: 'Active', format: 'bool' },
    },
    label: (doc) => `${doc.code} — ${doc.name}`,
  },
  stockAdjustment: {
    fields: {
      type: { label: 'Type', labels: Object.fromEntries(Object.entries(ADJUSTMENT_TYPES).map(([k, v]) => [k, v.label])) },
      gudang: { label: 'Warehouse', ref: ['Gudang', 'code'] },
      date: { label: 'Date', format: 'date' },
      reason: { label: 'Reason', labels: REASONS },
      note: { label: 'Note' },
      status: { label: 'Status' },
      lines: { label: 'Lines', format: 'stockLines' },
      cancelReason: { label: 'Cancel Reason' },
    },
    label: (doc) => doc.no,
  },
  stockTransfer: {
    fields: {
      fromGudang: { label: 'From Warehouse', ref: ['Gudang', 'code'] },
      toGudang: { label: 'To Warehouse', ref: ['Gudang', 'code'] },
      date: { label: 'Date', format: 'date' },
      note: { label: 'Note' },
      status: { label: 'Status', labels: { DRAFT: 'DRAFT', IN_TRANSIT: 'IN TRANSIT', RECEIVED: 'RECEIVED', CANCELLED: 'CANCELLED' } },
      lines: { label: 'Items', format: 'trfLines' },
      receiveNote: { label: 'Receive Note' },
      cancelReason: { label: 'Cancel Reason' },
    },
    label: (doc) => doc.no,
  },
  customer: {
    fields: {
      code: { label: 'Code' },
      name: { label: 'Name' },
      phone: { label: 'Phone' },
      email: { label: 'Email' },
      address: { label: 'Address' },
      npwp: { label: 'NPWP' },
      termDays: { label: 'Payment Term (days)', format: 'number' },
      priceList: { label: 'Price List', ref: ['PriceList', 'name'] },
      deskripsi: { label: 'Note' },
      isActive: { label: 'Active', format: 'bool' },
    },
    label: (doc) => `${doc.code} — ${doc.name}`,
  },
  salesInvoice: {
    fields: {
      customer: { label: 'Customer', ref: ['Customer', 'name'] },
      gudang: { label: 'Warehouse', ref: ['Gudang', 'code'] },
      date: { label: 'Date', format: 'date' },
      priceIncludesTax: { label: 'Price incl. PPN', format: 'bool' },
      taxRate: { label: 'Tax Rate (%)', format: 'number' },
      lines: { label: 'Items', format: 'salesLines' },
      discountAmount: { label: 'Document Discount', format: 'money' },
      total: { label: 'Total', format: 'money' },
      dueDate: { label: 'Due Date', format: 'date' },
      returnedAmount: { label: 'Returned', format: 'money' },
      paidAmount: { label: 'Paid', format: 'money' },
      paymentStatus: { label: 'Payment Status', labels: { UNPAID: 'Unpaid', PARTIAL: 'Partially paid', PAID: 'Paid', OVERPAID: 'Overpaid' } },
      status: { label: 'Status' },
      note: { label: 'Note' },
      cancelReason: { label: 'Cancel Reason' },
    },
    label: (doc) => doc.no,
  },
  outlet: {
    fields: {
      code: { label: 'Code' },
      name: { label: 'Name' },
      gudang: { label: 'Warehouse', ref: ['Gudang', 'code'] },
      phone: { label: 'Phone' },
      alamat: { label: 'Address' },
      provinsi: { label: 'Province' },
      kota: { label: 'City / Regency' },
      kecamatan: { label: 'District' },
      kodePos: { label: 'Postal Code' },
      latitude: { label: 'Latitude', format: 'coord' },
      longitude: { label: 'Longitude', format: 'coord' },
      priceIncludesTax: { label: 'Price incl. PPN', format: 'bool' },
      receiptHeader: { label: 'Receipt Header' },
      receiptFooter: { label: 'Receipt Footer' },
      receiptWidth: { label: 'Receipt Width (mm)', format: 'number' },
      deskripsi: { label: 'Description' },
      isActive: { label: 'Active', format: 'bool' },
    },
    label: (doc) => `${doc.code} — ${doc.name}`,
  },
  posShift: {
    fields: {
      outlet: { label: 'Outlet', ref: ['Outlet', 'code'] },
      cashier: { label: 'Cashier', ref: ['User', 'name'] },
      status: { label: 'Status' },
      openingCash: { label: 'Opening Cash', format: 'money' },
      cashMoves: { label: 'Cash In / Out', format: 'cashMoves' },
      closingCash: { label: 'Counted Cash', format: 'money' },
      expectedCash: { label: 'Expected Cash', format: 'money' },
      difference: { label: 'Difference', format: 'money' },
      closeNote: { label: 'Close Note' },
    },
    label: (doc) => doc.no,
  },
  priceList: {
    fields: {
      code: { label: 'Code' },
      name: { label: 'Name' },
      deskripsi: { label: 'Description' },
      isActive: { label: 'Active', format: 'bool' },
      items: { label: 'Prices', format: 'priceLines' },
    },
    label: (doc) => `${doc.code} — ${doc.name}`,
  },
  salesPayment: {
    fields: {
      type: { label: 'Type', labels: { PAYMENT: 'Payment', REFUND: 'Refund' } },
      salesInvoice: { label: 'Sales Invoice', ref: ['SalesInvoice', 'no'] },
      date: { label: 'Date', format: 'date' },
      method: { label: 'Method', labels: { CASH: 'Cash', CARD: 'Debit / Card', QRIS: 'QRIS', TRANSFER: 'Transfer', OTHER: 'Other' } },
      amount: { label: 'Amount', format: 'money' },
      reference: { label: 'Reference' },
      note: { label: 'Note' },
      status: { label: 'Status' },
      cancelReason: { label: 'Cancel Reason' },
    },
    label: (doc) => doc.no,
    parent: (doc) => ({ entity: 'salesInvoice', id: doc.salesInvoice?._id ?? doc.salesInvoice }),
  },
  salesReturn: {
    fields: {
      salesInvoice: { label: 'Sales Invoice', ref: ['SalesInvoice', 'no'] },
      date: { label: 'Date', format: 'date' },
      reason: { label: 'Reason' },
      lines: { label: 'Items', format: 'trfLines' },
      total: { label: 'Total', format: 'money' },
      status: { label: 'Status' },
      cancelReason: { label: 'Cancel Reason' },
    },
    label: (doc) => doc.no,
    // histori invoice ikut memuat returnya
    parent: (doc) => ({ entity: 'salesInvoice', id: doc.salesInvoice?._id ?? doc.salesInvoice }),
  },
  purchaseOrder: {
    fields: {
      vendor: { label: 'Vendor', ref: ['Vendor', 'companyName'] },
      gudang: { label: 'Warehouse', ref: ['Gudang', 'code'] },
      date: { label: 'Date', format: 'date' },
      expectedDate: { label: 'Expected Date', format: 'date' },
      taxRate: { label: 'Tax Rate (%)', format: 'number' },
      isPKP: { label: 'PKP', format: 'bool' },
      lines: { label: 'Items', format: 'poLines' },
      total: { label: 'Total', format: 'money' },
      status: { label: 'Status' },
      note: { label: 'Note' },
      closeReason: { label: 'Close Reason' },
      cancelReason: { label: 'Cancel Reason' },
    },
    label: (doc) => doc.no,
  },
  goodsReceipt: {
    fields: {
      purchaseOrder: { label: 'Purchase Order', ref: ['PurchaseOrder', 'no'] },
      date: { label: 'Date', format: 'date' },
      deliveryNoteNo: { label: 'Delivery Note No.' },
      lines: { label: 'Items', format: 'grLines' },
      status: { label: 'Status' },
      note: { label: 'Note' },
      cancelReason: { label: 'Cancel Reason' },
    },
    label: (doc) => doc.no,
    // histori PO ikut memuat penerimaannya
    parent: (doc) => ({ entity: 'purchaseOrder', id: doc.purchaseOrder?._id ?? doc.purchaseOrder }),
  },
  costRevaluation: {
    fields: {
      date: { label: 'Date', format: 'date' },
      note: { label: 'Reason' },
      status: { label: 'Status' },
      lines: { label: 'Items', format: 'revalLines' },
      cancelReason: { label: 'Cancel Reason' },
    },
    label: (doc) => doc.no,
  },
  reorderRule: {
    fields: {
      sku: { label: 'SKU', ref: ['ProdukSku', 'sku'] },
      gudang: { label: 'Warehouse', ref: ['Gudang', 'code'] },
      minQty: { label: 'Min', format: 'number' },
      maxQty: { label: 'Max', format: 'number' },
    },
    label: (doc, flat) => `${flat.sku?.text || '?'} @ ${flat.gudang?.text || '?'}`,
    // histori produk ikut memuat perubahan batas reorder-nya
    parent: (doc) => ({ entity: 'produk', id: doc.produk?._id ?? doc.produk }),
  },
  setting: {
    fields: {
      value: { label: 'Value' },
    },
    label: (doc) => getSettingDefinition(doc._id)?.label || doc._id,
  },
  menu: {
    fields: {
      menu: { label: 'Menu' },
      parent_id: { label: 'Parent', ref: ['Menu', 'menu'] },
      component: { label: 'Route' },
      icon: { label: 'Icon' },
      img: { label: 'Image' },
      deskripsi: { label: 'Description' },
      resource: { label: 'Permission', format: 'resource' },
      order: { label: 'Order', format: 'number' },
    },
    label: (doc) => doc.menu,
  },
};

const newBatchId = () => crypto.randomUUID();

const toPlain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject({ depopulate: true }) : doc);
const idOf = (v) => (v && typeof v === 'object' && v._id ? v._id : v);
const isEmpty = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/** Ambil teks semua referensi sekaligus: Map "<Model>:<id>" -> teks */
const resolveRefs = async (entity, docs) => {
  const wanted = new Map(); // modelName -> { textField, ids:Set }
  const add = (modelName, textField, id) => {
    if (!id || !mongoose.isValidObjectId(id)) return;
    if (!wanted.has(modelName)) wanted.set(modelName, { textField, ids: new Set() });
    wanted.get(modelName).ids.add(String(id));
  };

  const { fields } = ENTITIES[entity];
  for (const doc of docs) {
    for (const [field, def] of Object.entries(fields)) {
      if (def.ref) {
        const value = doc[field];
        (Array.isArray(value) ? value : [value]).forEach((v) => add(def.ref[0], def.ref[1], idOf(v)));
      }
      if (def.format === 'variantValues') {
        (doc[field] || []).forEach((vv) => add('Variant', 'code', idOf(vv.variant)));
      }
      if (['stockLines', 'poLines', 'grLines', 'revalLines', 'trfLines', 'salesLines', 'priceLines'].includes(def.format)) {
        (doc[field] || []).forEach((l) => {
          add('ProdukSku', 'sku', idOf(l.sku));
          if (l.uomBeli) add('Uom', 'code', idOf(l.uomBeli));
        });
      }
    }
  }

  const texts = new Map();
  await Promise.all([...wanted.entries()].map(async ([modelName, { textField, ids }]) => {
    const rows = await model(modelName).find({ _id: { $in: [...ids] } }).select(textField).lean();
    rows.forEach((r) => texts.set(`${modelName}:${r._id}`, r[textField]));
  }));
  return texts;
};

/** Nilai 1 field dalam bentuk yang mudah dibaca & dibandingkan */
const normalizeValue = (def, value, texts) => {
  if (def.secret) return undefined; // tidak pernah disimpan
  if (def.ref) {
    const toRef = (v) => {
      const id = idOf(v);
      if (!id) return null;
      return { id: String(id), text: texts.get(`${def.ref[0]}:${id}`) ?? '(deleted)' };
    };
    return Array.isArray(value) ? value.map(toRef).filter(Boolean) : toRef(value);
  }
  if (def.format === 'variantValues') {
    return (value || [])
      .map((vv) => `${texts.get(`Variant:${idOf(vv.variant)}`) || '?'}: ${vv.value}`)
      .join(', ') || 'Default';
  }
  if (def.labels) return value ? (def.labels[value] ?? value) : null;
  if (def.format === 'stockLines') {
    // 1 baris = 1 teks, mis. "KAOS-M: +5" atau "KAOS-M: count 12 (+2)"
    const num = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
    const signed = (n) => `${n > 0 ? '+' : ''}${num(n)}`;
    return (value || []).map((l) => {
      const sku = texts.get(`ProdukSku:${idOf(l.sku)}`) ?? '(deleted)';
      const parts = [];
      if (l.qtyActual !== null && l.qtyActual !== undefined) parts.push(`count ${num(l.qtyActual)}`);
      if (l.qtyChange !== null && l.qtyChange !== undefined) {
        parts.push(parts.length ? `(${signed(l.qtyChange)})` : signed(l.qtyChange));
      }
      return `${sku}: ${parts.join(' ') || '-'}${l.note ? ` · ${l.note}` : ''}`;
    });
  }
  if (def.format === 'trfLines') {
    // mis. "KAOS-M: 10" (dikirim) / "KAOS-M: 10 -> received 9"
    const num = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
    return (value || []).map((l) => {
      const sku = texts.get(`ProdukSku:${idOf(l.sku)}`) ?? '(deleted)';
      const recv = l.qtyReceived === null || l.qtyReceived === undefined ? '' : ` -> received ${num(l.qtyReceived)}`;
      return `${sku}: ${num(l.qty)}${recv}${l.note ? ` · ${l.note}` : ''}`;
    });
  }
  if (def.format === 'cashMoves') {
    // mis. "OUT 50,000 · beli galon"
    const num = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
    return (value || []).map((m) => `${m.type} ${num(m.amount)} · ${m.reason}`);
  }
  if (def.format === 'priceLines') {
    // mis. "KAOS-M: 75,000"
    const num = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
    return (value || []).map((l) => `${texts.get(`ProdukSku:${idOf(l.sku)}`) ?? '(deleted)'}: ${num(l.price)}`);
  }
  if (def.format === 'salesLines') {
    // mis. "KAOS-M: 2 x 75,000 -10%"
    const num = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
    return (value || []).map((l) => {
      const sku = texts.get(`ProdukSku:${idOf(l.sku)}`) ?? '(deleted)';
      return `${sku}: ${num(l.qty)} x ${num(l.hargaJual)}${l.diskonPersen ? ` -${num(l.diskonPersen)}%` : ''}${l.note ? ` · ${l.note}` : ''}`;
    });
  }
  if (def.format === 'revalLines') {
    // mis. "KAOS-M: HPP 9,000 -> 9,500" (HPP lama diisi saat post)
    const num = (n) => (n === null || n === undefined ? '-' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }));
    return (value || []).map((l) => {
      const sku = texts.get(`ProdukSku:${idOf(l.sku)}`) ?? '(deleted)';
      const from = l.qty === null || l.qty === undefined ? '' : `${num(l.oldCost)} -> `;
      return `${sku}: HPP ${from}${num(l.newCost)}${l.note ? ` · ${l.note}` : ''}`;
    });
  }
  if (def.format === 'poLines' || def.format === 'grLines') {
    // mis. "KAOS-M: 10 BOX x 120,000 -5%" (PO) / "KAOS-M: 4 BOX" (GR)
    const num = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
    return (value || []).map((l) => {
      const sku = texts.get(`ProdukSku:${idOf(l.sku)}`) ?? '(deleted)';
      const uom = texts.get(`Uom:${idOf(l.uomBeli)}`) ?? '';
      let text = `${sku}: ${num(l.qty)} ${uom}`.trim();
      if (def.format === 'poLines') {
        text += ` x ${num(l.hargaBeli)}${l.diskonPersen ? ` -${num(l.diskonPersen)}%` : ''}`;
      }
      return `${text}${l.note ? ` · ${l.note}` : ''}`;
    });
  }
  if (def.format === 'resource') return value ? getResourceLabel(value) : null;
  if (def.format === 'list') return Array.isArray(value) ? [...value] : [];
  if (def.format === 'permissions') {
    // { produk: 'view, create', ... } -> dibandingkan per resource
    return Object.fromEntries((value || []).map((p) => [p.resource, (p.actions || []).join(', ')]));
  }
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && value._bsontype) return String(value);
  return value ?? null;
};

/**
 * Snapshot "rata" untuk banyak dokumen: Map id -> { raw, flat }.
 * Panggil SEBELUM perubahan (untuk update/delete) dan sesudahnya (otomatis di logUpdate).
 */
const snap = async (entity, docs) => {
  const plain = docs.filter(Boolean).map(toPlain);
  const texts = await resolveRefs(entity, plain);
  const { fields } = ENTITIES[entity];
  return new Map(plain.map((raw) => [String(raw._id), {
    raw,
    flat: Object.fromEntries(Object.entries(fields).map(([f, def]) => [f, normalizeValue(def, raw[f], texts)])),
  }]));
};

// format yang disimpan sebagai daftar teks (ditampilkan + ditambah / - dihapus)
const LIST_FORMATS = ['list', 'stockLines', 'poLines', 'grLines', 'revalLines', 'trfLines', 'salesLines', 'priceLines', 'cashMoves'];

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const sameRef = (a, b) => {
  const ids = (v) => (Array.isArray(v) ? v.map((x) => x.id).sort().join(',') : v?.id ?? null);
  return ids(a) === ids(b);
};

/** Daftar perubahan antara 2 snapshot rata. Permission dipecah per resource. */
const diff = (entity, before, after, { rawBefore, rawAfter } = {}) => {
  const { fields } = ENTITIES[entity];
  const changes = [];
  for (const [field, def] of Object.entries(fields)) {
    if (def.secret) {
      const a = rawBefore?.[field];
      const b = rawAfter?.[field];
      if ((a || b) && a !== b) changes.push({ field, label: def.label, format: 'secret', from: null, to: null });
      continue;
    }
    const a = before?.[field] ?? null;
    const b = after?.[field] ?? null;

    if (def.format === 'permissions') {
      const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
      for (const key of keys) {
        const from = a?.[key] || null;
        const to = b?.[key] || null;
        if (from !== to) changes.push({ field: `${field}.${key}`, label: `${def.label}: ${getResourceLabel(key)}`, format: 'text', from, to });
      }
      continue;
    }

    const sorted = (v) => (Array.isArray(v) ? [...v].sort() : v);
    const changed = def.ref ? !sameRef(a, b)
      : LIST_FORMATS.includes(def.format) ? !same(sorted(a), sorted(b)) // urutan saja bukan perubahan
        : !same(a, b);
    if (changed && !(isEmpty(a) && isEmpty(b))) {
      // stockLines ditampilkan sebagai daftar (+ ditambah / - dihapus) di frontend
      const format = LIST_FORMATS.includes(def.format) ? 'list' : def.format || (def.ref ? 'ref' : 'text');
      changes.push({ field, label: def.label, format, from: a, to: b });
    }
  }
  return changes;
};

const clientIp = (req) => String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || null;

/** Tulis log (ikut transaksi yang sedang berjalan). Error di-throw supaya transaksi batal. */
const write = async (req, entries, actor) => {
  if (!entries.length) return;
  const user = actor !== undefined ? actor : req.user;
  const now = new Date();
  await AuditLog.insertMany(entries.map((e) => ({
    ...e,
    user: user?._id ?? null,
    userName: user?.name ?? null,
    ip: clientIp(req),
    date: now,
  })));
};

const base = (entity, raw, flat, opts) => {
  const def = ENTITIES[entity];
  return {
    entity,
    entityId: mongoose.isValidObjectId(raw._id) && String(raw._id).length === 24 ? raw._id : null,
    entityLabel: def.label(raw, flat),
    parent: def.parent ? def.parent(raw) : undefined,
    batchId: opts.batchId || null,
  };
};

// beberapa log dari 1 aksi otomatis dikelompokkan
const withBatch = (opts, count) => ({ ...opts, batchId: opts.batchId || (count > 1 ? newBatchId() : null) });

/** Record baru: semua field yang terisi dicatat sebagai perubahan dari kosong. */
const logCreate = async (req, entity, docs, opts = {}) => {
  const snaps = await snap(entity, docs);
  const o = withBatch(opts, snaps.size);
  const entries = [...snaps.values()].map(({ raw, flat }) => ({
    ...base(entity, raw, flat, o),
    action: 'create',
    changes: diff(entity, {}, flat, { rawAfter: raw }),
  }));
  await write(req, entries);
};

/**
 * Perubahan: `before` = hasil snap() sebelum diubah, `afterDocs` = dokumen sesudah diubah.
 * Record tanpa perubahan nyata tidak dicatat.
 */
const logUpdate = async (req, entity, before, afterDocs, opts = {}) => {
  const after = await snap(entity, afterDocs);
  const entries = [];
  for (const [id, cur] of after) {
    const prev = before.get(id);
    if (!prev) continue;
    const changes = diff(entity, prev.flat, cur.flat, { rawBefore: prev.raw, rawAfter: cur.raw });
    if (changes.length) entries.push({ raw: cur.raw, flat: cur.flat, changes });
  }
  const o = withBatch(opts, entries.length);
  await write(req, entries.map(({ raw, flat, changes }) => ({
    ...base(entity, raw, flat, o),
    action: 'update',
    changes,
  })));
};

/**
 * Penghapusan: `snapshots` = hasil snap() SEBELUM dihapus.
 * Nilai terakhir dicatat sebagai perubahan ke kosong + snapshot dokumen lengkap.
 */
const logDelete = async (req, entity, snapshots, opts = {}) => {
  const o = withBatch(opts, snapshots.size);
  const secretFields = Object.entries(ENTITIES[entity].fields).filter(([, d]) => d.secret).map(([f]) => f);
  await write(req, [...snapshots.values()].map(({ raw, flat }) => {
    const snapshot = { ...raw };
    secretFields.forEach((f) => delete snapshot[f]);
    return {
      ...base(entity, raw, flat, o),
      action: 'delete',
      changes: diff(entity, flat, {}).filter((c) => c.format !== 'secret'),
      snapshot,
    };
  }));
};

/** Login berhasil / gagal. `user` boleh null (email tidak terdaftar). Tidak pernah throw. */
const logLogin = async (req, { success, user, email, reason }) => {
  try {
    await writeLogin(req, { success, user, email, reason });
  } catch (err) {
    console.error('[audit] failed to write login log:', err.message);
  }
};

const writeLogin = (req, { success, user, email, reason }) => write(req, [{
    entity: 'auth',
    entityId: user?._id ?? null,
    entityLabel: String(email || user?.email || '').slice(0, 200) || null,
    action: success ? 'login' : 'login_failed',
    meta: {
      ...(reason ? { reason } : {}),
      userAgent: String(req.headers?.['user-agent'] || '').slice(0, 300) || undefined,
    },
  }], user || null);

module.exports = {
  ENTITIES,
  newBatchId,
  snap,
  diff,
  logCreate,
  logUpdate,
  logDelete,
  logLogin,
};
