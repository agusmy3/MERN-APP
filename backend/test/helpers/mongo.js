/**
 * Replica set MongoDB sementara untuk test (transaksi butuh replica set).
 * Menjalankan mongod LOKAL di port acak dengan data di folder temp; dihapus setelah selesai.
 *
 * Lokasi mongod: env MONGOD_BIN, atau lokasi default instalasi Windows / `mongod` di PATH.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { MongoClient } = require('mongodb');

const DEFAULT_BINS = [
  'C:/Program Files/MongoDB/Server/8.0/bin/mongod.exe',
  'C:/Program Files/MongoDB/Server/7.0/bin/mongod.exe',
  '/usr/bin/mongod',
  '/usr/local/bin/mongod',
];

const findMongod = () => process.env.MONGOD_BIN || DEFAULT_BINS.find((p) => fs.existsSync(p)) || 'mongod';

const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
  srv.on('error', reject);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startReplSet() {
  const port = await freePort();
  const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'mern-test-'));
  const proc = spawn(findMongod(), [
    '--replSet', 'rstest', '--port', String(port), '--bind_ip', '127.0.0.1',
    '--dbpath', dbPath, '--oplogSize', '50', '--quiet', '--logpath', path.join(dbPath, 'mongod.log'),
  ], { stdio: 'ignore' });
  let exited = null;
  proc.on('exit', (code) => { exited = code; });
  proc.on('error', (err) => { exited = err.message; });

  // tunggu port siap, lalu rs.initiate & tunggu PRIMARY
  const host = `127.0.0.1:${port}`;
  const client = new MongoClient(`mongodb://${host}/?directConnection=true`, { serverSelectionTimeoutMS: 1000 });
  for (let i = 0; ; i++) {
    if (exited !== null) throw new Error(`mongod failed to start (${exited}). Set MONGOD_BIN to the mongod path.`);
    try { await client.connect(); break; } catch (e) { if (i > 60) throw e; await sleep(250); }
  }
  try {
    await client.db('admin').command({ replSetInitiate: { _id: 'rstest', members: [{ _id: 0, host }] } });
  } catch (e) {
    if (!/already initialized/i.test(e.message)) throw e;
  }
  for (let i = 0; ; i++) {
    const hello = await client.db('admin').command({ hello: 1 });
    if (hello.isWritablePrimary) break;
    if (i > 120) throw new Error('replica set did not become PRIMARY');
    await sleep(250);
  }
  await client.close();

  return {
    uri: `mongodb://${host}/mern-test?replicaSet=rstest`,
    async stop() {
      proc.kill();
      for (let i = 0; i < 40 && exited === null; i++) await sleep(100);
      fs.rmSync(dbPath, { recursive: true, force: true });
    },
  };
}

module.exports = { startReplSet };
