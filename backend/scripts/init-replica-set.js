/**
 * Inisialisasi replica set satu node (idempotent). Biasanya dipanggil oleh setup-replica-set.ps1.
 *   cd backend && npm run rs:init
 *
 * Syarat: mongod sudah dijalankan dengan replication.replSetName (lihat setup-replica-set.ps1).
 * Opsi env: RS_HOST (default 127.0.0.1:27017), RS_NAME (default rs0)
 */
const { MongoClient } = require('mongodb');

const HOST = process.env.RS_HOST || '127.0.0.1:27017';
const NAME = process.env.RS_NAME || 'rs0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // directConnection: konek ke node ini apa adanya walau replica set belum terbentuk
  const client = new MongoClient(`mongodb://${HOST}/?directConnection=true`, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const admin = client.db('admin');

  try {
    let hello = await admin.command({ hello: 1 });
    if (hello.setName) {
      console.log(`[=] Replica set "${hello.setName}" sudah aktif (primary: ${hello.isWritablePrimary ? 'ya' : 'belum'})`);
    } else {
      try {
        await admin.command({
          replSetInitiate: { _id: NAME, members: [{ _id: 0, host: HOST }] },
        });
        console.log(`[+] Replica set "${NAME}" diinisialisasi dengan member ${HOST}`);
      } catch (err) {
        if (err.codeName === 'NoReplicationEnabled') {
          console.error('[!] mongod belum dijalankan dengan replication.replSetName.');
          console.error('    Jalankan backend/scripts/setup-replica-set.ps1 sebagai Administrator.');
          process.exitCode = 1;
          return;
        }
        if (err.codeName !== 'AlreadyInitialized') throw err;
      }
    }

    // tunggu node menjadi PRIMARY (biasanya beberapa detik)
    for (let i = 0; i < 30; i++) {
      hello = await admin.command({ hello: 1 });
      if (hello.isWritablePrimary) {
        console.log(`[+] Node ${HOST} sudah PRIMARY. Transaksi siap dipakai.`);
        return;
      }
      await sleep(1000);
    }
    console.error('[!] Node belum menjadi PRIMARY setelah 30 detik. Cek log mongod.');
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('[!]', err.message);
  process.exitCode = 1;
});
