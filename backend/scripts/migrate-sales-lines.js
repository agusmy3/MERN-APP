/**
 * Kemasan jual: baris dokumen penjualan lama -> ID baris & rujukan antarbaris. Aman dijalankan berulang.
 *   cd backend && npm run migrate:sales-lines
 *
 * - Baris Sales Order & Sales Invoice tanpa _id diberi _id (dirujuk surat jalan / retur).
 * - Baris Delivery Order tanpa soLine dicocokkan ke baris SO per SKU; baris Sales Return tanpa invoiceLine
 *   dicocokkan ke baris invoice per SKU (data lama selalu 1 baris per SKU).
 * Field satuan jual (uom / konversi / qtyUom) tidak perlu diisi: kosong = satuan dasar.
 * Wajib sekali pada database yang sudah punya dokumen penjualan sebelum fitur kemasan jual.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const mongoose = require('mongoose');

const missingId = { lines: { $elemMatch: { _id: { $exists: false } } } };

/** -> { lineIds, deliveryLinks, returnLinks } jumlah dokumen yang diubah */
const migrateSalesLines = async (db = mongoose.connection.db) => {
  const result = { lineIds: 0, deliveryLinks: 0, returnLinks: 0 };
  for (const name of ['salesorders', 'salesinvoices']) {
    const col = db.collection(name);
    for (const doc of await col.find(missingId).project({ lines: 1 }).toArray()) {
      const lines = doc.lines.map((l) => (l._id ? l : { _id: new mongoose.Types.ObjectId(), ...l }));
      await col.updateOne({ _id: doc._id }, { $set: { lines } });
      result.lineIds += 1;
    }
  }

  const link = async (colName, parentCol, parentField, linkField, counter) => {
    const col = db.collection(colName);
    const docs = await col.find({ lines: { $elemMatch: { [linkField]: { $in: [null] } } } }).project({ lines: 1, [parentField]: 1 }).toArray();
    for (const doc of docs) {
      const parent = await db.collection(parentCol).findOne({ _id: doc[parentField] }, { projection: { lines: 1 } });
      if (!parent) continue;
      const lines = doc.lines.map((l) => {
        if (l[linkField]) return l;
        const match = parent.lines.filter((pl) => String(pl.sku) === String(l.sku));
        return match.length === 1 ? { ...l, [linkField]: match[0]._id } : l;
      });
      await col.updateOne({ _id: doc._id }, { $set: { lines } });
      result[counter] += 1;
    }
  };
  await link('deliveryorders', 'salesorders', 'salesOrder', 'soLine', 'deliveryLinks');
  await link('salesreturns', 'salesinvoices', 'salesInvoice', 'invoiceLine', 'returnLinks');
  return result;
};

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const r = await migrateSalesLines();
  console.log(`[+] baris SO/invoice diberi id: ${r.lineIds} dokumen`);
  console.log(`[+] surat jalan ditautkan ke baris SO: ${r.deliveryLinks} dokumen`);
  console.log(`[+] retur ditautkan ke baris invoice: ${r.returnLinks} dokumen`);
}

if (require.main === module) {
  main()
    .then(() => mongoose.disconnect())
    .catch(async (err) => {
      console.error(err);
      await mongoose.disconnect();
      process.exit(1);
    });
}

module.exports = { migrateSalesLines };
