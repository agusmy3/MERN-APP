# mern-app

Aplikasi admin full-stack MERN (MongoDB, Express, React, Node.js) untuk mengelola data master (**Kategori, Produk, Vendor, UoM, Variant, Gudang, Menu**) **stok** (Stock Adjustment / Opname, Stock Transfer antar gudang, kartu stok per gudang), dan **pembelian** (Purchase Order, Goods Receipt, HPP rata-rata), dengan autentikasi JWT dan otorisasi berbasis role (RBAC: **User, Role**). Sidebar aplikasi dibangun secara dinamis dari data Menu di database.

## Struktur

```
mern-app/
├── backend/   Express 5 + Mongoose 8 (CommonJS)
└── frontend/  React 19 + Vite 7 + Tailwind CSS 4 (ESM)
```

Tidak ada package.json di root; backend dan frontend dijalankan terpisah.

## Menjalankan

**Backend** (`backend/`):
```
npm run dev      # node --watch server.js, auto-restart saat file berubah
npm start        # node server.js
npm test         # semua test (unit + API); npm run test:unit | test:api | test:watch
npm run db:init -- --email=<email> --password=<password>  # SIAPKAN DATABASE (baru/lama), idempotent: cek replica set, koleksi & index (hanya menambah), Super Admin pertama (jika belum ada user), seed:rbac, menu:organize --apply, migrate:uom-type
npm run seed:admin -- --email=... --password=...  # Super Admin pertama, hanya jika belum ada user (atau ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME di .env; password min. 8)
npm run seed:demo  # data contoh (4 produk, 12 SKU, 2 gudang, 3 vendor fiktif, stok awal ber-HPP, reorder, PO terlambat, draft); DITOLAK jika sudah ada produk
npm run seed:rbac  # migrasi RBAC (idempotent): role Super Admin -> admin@mern.com, tautkan Menu ke resource, buat menu User, Role, Audit Log, System Settings, Warehouse, grup Inventory (Stock Adjustment, Stock Transfer, Stock Movement, Reorder, Stock Valuation, Cost Revaluation) & grup Purchasing (Purchase Order, Goods Receipt)
npm run menu:organize  # rapikan menu ke susunan standar (Dashboard, Master Data, Inventory, Purchasing, Settings); default dry-run, `-- --apply` untuk menerapkan (backup JSON di backend/backups/, diabaikan git; audit log)
npm run migrate:produk-sku  # migrasi produk lama (idempotent): UoM PCS, 1 SKU default per produk (harga -> hargaJual, qty -> stok)
npm run migrate:stock-opening  # (idempotent) gudang MAIN + 1 dokumen Saldo Awal (POSTED) untuk stok SKU yang belum punya kartu stok; argumen opsional: kode gudang
npm run migrate:avg-cost       # (idempotent) HPP awal SKU yang kosong = harga vendor utama / termurah per satuan dasar
npm run migrate:uom-type       # (idempotent) isi jenis UoM yang kosong dari kodenya (PCS -> Count, KG -> Weight, BOX -> Package), laporkan harga vendor yang konversinya tidak cocok
npm run stock:reconcile        # cek StockBalance & ProdukSku.stok vs kartu stok; `-- --fix` menulis ulang cache dari movement
npm run rs:init  # inisialisasi replica set 1 node (idempotent; biasanya lewat setup-replica-set.ps1)
```
Butuh `backend/.env` dengan `MONGO_URI`, `JWT_SECRET`, `PORT` (default 5000).

**Database baru / dikosongkan:** aktifkan replica set (di bawah), lalu `npm run db:init -- --email=... --password=...` (+ `npm run seed:demo` untuk data contoh). Script `migrate:*` hanya untuk memindahkan data lama (aman, tidak berbuat apa-apa di database kosong).

**MongoDB wajib replica set** (untuk transaksi). Standalone -> backend berhenti saat start dengan petunjuk. Setup sekali di Windows (PowerShell *Run as Administrator*, dari `backend/`):
```
powershell -ExecutionPolicy Bypass -File .\scripts\setup-replica-set.ps1
```
Script: backup + tambah `replication` (`replSetName: rs0`, `oplogSizeMB: 1024`) di `mongod.cfg`, restart service `MongoDB`, `rs.initiate`, lalu tambah `replicaSet=rs0` ke `MONGO_URI`.

**Frontend** (`frontend/`):
```
npm run dev      # Vite dev server, proxy /api -> http://localhost:5000
npm run build
npm run lint     # ESLint
npm test         # test utilitas (node:test)
```

### Test

- **Backend** (`backend/test/`, runner bawaan `node:test`, tanpa dependensi tambahan):
  - `unit/`: fungsi murni (number, HPP & pembelian, permissions, audit diff).
  - `api/`: lewat HTTP ke app sungguhan (`fetch` ke `app.listen(0)`): RBAC, stok, pembelian, HPP, konkurensi/rollback, menu, reorder, dashboard.
  - [test/helpers/mongo.js](backend/test/helpers/mongo.js) menjalankan **mongod lokal** sebagai replica set sementara (port acak, folder temp, dihapus setelah selesai) per file test; lokasi mongod dari env `MONGOD_BIN` atau path instalasi default.
  - [test/helpers/setup.js](backend/test/helpers/setup.js): `const t = useTestApp()` lalu `const admin = await t.loginAs()` / `t.loginAs({ produk: ['update'] })` -> client `get/post/put/del` yang mengembalikan `{ status, data, message }`. [factory.js](backend/test/helpers/factory.js): `createMasters`, `createProduct`, `postAdjustment`, `ok(res, status)`.
  - **Fitur / endpoint baru wajib disertai test API-nya.**
- **Frontend** (`frontend/test/`, `node:test` + resolver import tanpa ekstensi di `test/register.mjs`): fungsi utilitas di `src/utils`. Test komponen (Vitest + React Testing Library) menyusul setelah dependensinya dipasang.

## Backend

- Entry: [backend/server.js](backend/server.js) (dotenv, koneksi DB, listen) memakai [backend/app.js](backend/app.js) (CORS, JSON body, header `Cache-Control: no-store`, mount route; **tanpa** koneksi DB / listen, supaya bisa dipakai test).
- Pola per resource: `models/` → `controllers/` → `routes/`.
- Route yang terdaftar:
  - `/api/auth`: `POST /login` (publik), `GET /me` (profil + role + izin efektif), `PUT /theme`. **Registrasi publik dimatikan**; user dibuat admin lewat `/api/user`.
  - `/api/kategori`, `/api/vendor`, `/api/produk`, `/api/uom`, `/api/variant`, `/api/gudang`: `GET /dropdown`, `GET /all`, `GET /` (paginasi), `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id`
  - `/api/menu`: `GET /tree` (sidebar, disaring sesuai izin user), `GET /dropdown`, `GET /all`, `GET /` (paginasi), `GET /getHierarchy`, `POST`, `PUT /:id`, `DELETE /:id`
  - `/api/role`: `GET /resources` (registri untuk matriks), `GET /dropdown`, CRUD standar. `/api/user`: CRUD standar (tanpa `/all`).
  - `/api/produk/:id/sku`: `GET` (list SKU + harga pokok jika boleh lihat harga vendor), `POST /generate` (kombinasi varian), `PUT` (bulk update), `DELETE /:skuId`. Mengelola SKU butuh izin `produk:update`.
  - `/api/audit-log` (baca saja): `GET /history?entity=produk|role|user|kategori|vendor|uom|variant|menu|gudang|stockAdjustment&id=` (histori 1 record, izin = view resource record tsb; produk ikut memuat SKU & harga vendornya, user ikut memuat riwayat login), `GET /` (halaman global, izin `auditLog:view`, filter `search|entity|action|from|to`). Isi selalu disaring sesuai izin view per resource (log harga vendor butuh `vendorPrice:view`).
  - `/api/stock-adjustment`: `GET /` (paginasi; filter `search|status|type|reason|gudang|from|to`, tanpa baris + `lineCount`), `GET /:id` (draft: + `currentQty` per baris), `GET /skus?gudang=&search=|produk=|kategori=` (cari SKU lintas produk + saldo gudang), `POST /skus/balance` (`{ gudang, skus }` -> saldo), `POST /` / `PUT /:id` / `DELETE /:id` (**draft saja**), `POST /:id/post`, `POST /:id/cancel` (`{ reason }`). Izin: create/update/delete = draft, **`post`** = posting & pembatalan.
  - `/api/reorder` (resource `reorder`: view / update): `GET /` (alert; `status=OUT|CRITICAL|ORDERED|ALL`, `gudang`, `kategori`, `vendor`, `search`; + saran dari vendor utama dalam satuan beli, + `priceOptions` semua harga vendor per SKU untuk pilihan satuan), `GET /summary` (badge), `GET /rules?produk=`, `PUT /rules` (`{ rules: [{ sku, gudang, minQty, maxQty }] }`, kosong = hapus), `POST /create-po` (`{ items }` -> draft PO per vendor + gudang, juga butuh `purchaseOrder:create`).
  - `/api/dashboard` (cukup login): widget sesuai izin user (`?tz=` untuk pengelompokan hari/bulan); angka biaya hanya untuk `vendorPrice:view`.
  - `/api/cost-revaluation` (resource `costRevaluation`, + action `post`): `GET /`, `GET /:id`, `GET /skus?search=|produk=|kategori=|missingOnly=true`, `POST` / `PUT /:id` / `DELETE /:id` (draft), `POST /:id/post`, `POST /:id/cancel` (`{ reason }`).
  - `/api/stock-valuation` (izin **`vendorPrice:view`**, karena nilai persediaan = data biaya): `GET ?groupBy=sku|produk|kategori|gudang&gudang=&kategori=&search=&missingOnly=` -> `{ rows, totals: { value, skuCount, missingCost } }` (saldo saat ini x HPP; SKU tanpa HPP bernilai 0 & ditandai; qty hanya untuk grup sku/produk).
  - `/api/purchase-order`: `GET /` (filter `search|status (ACTIVE = OPEN+PARTIAL)|vendor|gudang|from|to`, + `lineCount`, `receivedPercent` dalam satuan dasar), `GET /:id` (+ `outstanding`, `unitCost` per baris, `receipts`), `GET /items?vendor=&search=&scope=vendor|all` (SKU + pilihan harga vendor; `vendor` = hanya SKU berharga vendor tsb, `all` = semua SKU, search wajib), `POST /` / `PUT /:id` (draft; `issue: true` = langsung terbit), `DELETE /:id` (draft), `POST /:id/issue`, `POST /:id/cancel` (OPEN), `POST /:id/close` (PARTIAL), keduanya `{ reason }`. Izin: create; update (ubah draft, issue, cancel, close); delete.
  - `/api/goods-receipt`: `GET /`, `GET /:id`, `GET /po-options?search=` (PO OPEN/PARTIAL), `GET /from-po/:poId` (baris + sisa, tanpa harga beli), `POST /` / `PUT /:id` / `DELETE /:id` (draft), `POST /:id/post` (`{ updateVendorPrice }`, butuh juga `vendorPrice:create+update`), `POST /:id/cancel` (`{ reason }`). Izin `post` untuk post & cancel.
  - `/api/setting`: `GET /` (cukup login: `{ definitions, values }`), `PUT /` (`{ values: { key: value } }`, izin `setting:update`).
  - `/api/stock-movement` (baca saja, izin `stockMovement:view`): `GET /` (kartu stok; filter `produk|sku|gudang|type|from|to|search`), `GET /balance?produk=` (saldo per SKU per gudang, + `accessible` per gudang).
  - `/api/stock-transfer` (resource `stockTransfer`, + action `post`): `GET /` (filter `search|status|fromGudang|toGudang|gudang|from|to`, + `lineCount`, `totalQty`, `totalReceived`, `totalValue`), `GET /:id` (+ `currentQty` draft, `canSend`/`canReceive`, biaya untuk `vendorPrice:view`), `GET /skus`, `POST /skus/balance` (handler Stock Adjustment), `POST` / `PUT /:id` / `DELETE /:id` (draft), `POST /:id/send`, `POST /:id/receive` (`{ lines: [{ sku, qtyReceived }], note }`), `POST /:id/cancel` (`{ reason }`, hanya IN_TRANSIT).
  - `/api/vendor-price`: `GET ?produk=|vendor=|sku=` (salah satu wajib; tiap baris + `hargaPerUnit`), `POST` (banyak SKU sekaligus, upsert per vendor+sku+uomBeli), `PUT /:id`, `DELETE /:id`. Izin resource `vendorPrice` (terpisah dari `produk`, karena harga beli sensitif).
- Auth: [middlewares/authMiddleware.js](backend/middlewares/authMiddleware.js) (`protect`) memvalidasi `Authorization: Bearer <token>`, mengisi `req.user` (tanpa password, **role sudah di-populate**), menolak user yang dihapus atau `isActive: false` (401). Token dibuat oleh [utils/generateToken.js](backend/utils/generateToken.js) (berlaku 7 hari).

### Otorisasi (RBAC)

- Satu user = satu role (`User.role`). Izin disimpan di `Role.permissions: [{ resource, actions }]`, action: `view` (buka menu, tabel, search, detail), `create`, `update`, `delete`, dan `post` (hanya resource yang mendeklarasikannya, mis. `stockAdjustment`: posting/pembatalan dokumen stok, supaya pembuat draft dan pemosting bisa dipisah). Action selain `view` hanya sah jika `view` juga ada.
- Registri resource: [config/permissions.js](backend/config/permissions.js) (sumber kebenaran; juga dikirim ke frontend lewat `GET /api/role/resources`).
- **Setiap endpoint data wajib `protect` + `authorize(resource, action)`** ([middlewares/authorize.js](backend/middlewares/authorize.js)); tanpa izin -> **403** (bukan 401). Pola route: `GET /`, `GET /:id`, `GET /all` -> view; `POST` -> create; `PUT` -> update; `DELETE` -> delete.
- `GET /dropdown` cukup `protect` (tanpa izin view), untuk pilihan di form resource lain; **hanya field ringkas** (`_id` + `name`/`code`) via `dropdownHandler` di [helpers/dropdownHelper.js](backend/helpers/dropdownHelper.js). Daftarkan sebelum `/:id`.
- Role `isSystem` (Super Admin) melewati semua cek, tidak bisa diubah/dihapus. Backend mencegah: hapus role yang masih dipakai, ubah role/nonaktifkan/hapus akun sendiri, dan kehilangan Super Admin aktif terakhir.
- `Menu.resource` menautkan menu ke resource: sidebar (`/api/menu/tree`) hanya memuat menu yang boleh di-view; menu tanpa resource tapi punya route = semua user; menu grup tampil jika ada anak yang tampil.
- Resource tanpa `actions` = `view/create/update/delete`; resource boleh membatasi/menambah action-nya (`actions: ['view']` untuk `auditLog` & `stockMovement`, `+ 'post'` untuk `stockAdjustment`). `GET /api/role/resources` mengirim daftar action efektif per resource; matriks Role menampilkan "–" untuk action yang tidak berlaku. UI: `usePermission(...).canPost`.
- **Akses gudang** ([helpers/gudangAccess.js](backend/helpers/gudangAccess.js)): `User.allGudang` (default true, juga user lama) / `User.gudangs`; Super Admin selalu semua gudang. `gudangScope(req)` (null = semua), `assertGudang(req, ...ids)` (403), `applyGudangFilter(req, filter, req.query.gudang)` untuk daftar. Dibatasi: dokumen stok, transfer, PO/GR, kartu stok, valuasi, reorder, dashboard. **Jumlah** stok gudang lain tetap boleh dilihat (tab Stock produk, tanpa nilai; kartu stoknya terkunci). `GET /api/gudang/dropdown` menandai `accessible`; frontend `getMyGudangDropdown` = hanya yang accessible. `GET /api/auth/me` mengirim `gudangAccess: { all, gudangs }`. **Endpoint baru yang memakai gudang wajib memakai helper ini.** Audit Log belum disaring per gudang.
- Menambah resource baru: tambah di `RESOURCES`, pasang `authorize` di route, guard di `App.jsx`, `resource` di `useCrudDrawer` halaman, lalu set Permission di data Menu.

### Transaksi

- **Semua endpoint tulis** dibungkus `runInTransaction` ([helpers/transaction.js](backend/helpers/transaction.js)); session diteruskan otomatis (`transactionAsyncLocalStorage`), jadi query di dalamnya tidak perlu `{ session }`.
  ```js
  const doc = await runInTransaction(async () => {
    const doc = await Model.findById(id);                       // baca DI DALAM transaksi
    if (!doc) throw new HttpError('Not found', 404);            // throw = semua perubahan batal
    await lock(ref('kategori', doc.kategori));                  // lihat aturan lock di bawah
    ... tulis data + audit.log*() ...
    return doc;
  });
  return successResponse(res, doc, ...);                         // response DI LUAR transaksi
  ```
  `handleError` tiap controller memetakan `HttpError` ke status-nya.
- Callback bisa **dijalankan ulang otomatis** saat bentrok dengan transaksi lain: isinya hanya operasi database (tanpa kirim response / API luar). Validasi input murni boleh di luar.
- **Write skew**: transaksi hanya bentrok jika menulis dokumen yang sama, jadi aturan lintas dokumen butuh `lock(key)` (dokumen di koleksi `txlocks`) di semua transaksi yang menyangkut aturan tsb:
  - `ref('<entity>', id)`: hapus Kategori/UoM/Variant/Vendor/Role/Menu/Produk <-> create/update yang mereferensikannya (produk, SKU, harga vendor, user, sub-menu).
  - `ref('gudang', id)`: hapus Gudang <-> dokumen stok baru / posting di gudang tsb. Draft stok juga mengunci `ref('produk', ...)` tiap SKU-nya (hapus SKU/produk mengecek pemakaian di dokumen stok).
  - `preferred:<skuId>`: maks. 1 vendor utama per SKU. `superadmin`: min. 1 Super Admin aktif.
  - **Stok**: saldo dibaca lalu ditulis di transaksi yang sama (`applyMovements`), jadi dua posting untuk SKU+gudang yang sama pasti bentrok dan salah satu diulang dengan saldo terbaru; tidak perlu `lock`.

### Stok

- **Stok hanya berubah lewat dokumen** (sekarang: Stock Adjustment; nanti pembelian/penjualan/transfer) melalui `applyMovements(req, entries, { refType, refId, refNo, isReversal })` di [helpers/stockHelper.js](backend/helpers/stockHelper.js), di dalam `runInTransaction`. **Jangan** menulis `ProdukSku.stok` / `StockBalance` langsung; `PUT /api/produk/:id/sku` mengabaikan field `stok`.
- Tiga lapis: `StockMovement` (kartu stok, **append-only**, sumber kebenaran, `balanceAfter` per SKU+gudang) -> `StockBalance` (saldo per SKU + **gudang**, cache) -> `ProdukSku.stok` (total semua gudang, cache). `npm run stock:reconcile` memeriksanya.
- Stok **tidak boleh minus**: satu baris minus -> `HttpError` -> seluruh dokumen batal. Kesalahan dikoreksi dengan **Cancel** (movement pembalik `isReversal`), tidak ada yang dihapus. Movement tidak dicatat di AuditLog (dokumennya yang diaudit).
- **Angka maks. 2 desimal** (stok, qty, harga, konversi, min. order): validasi `checkAmount()` dan pembulatan `round2()` dari [helpers/number.js](backend/helpers/number.js) (frontend: `round2`, `formatNumber`, `formatSigned` di `utils/formatHelper.js`; input `step="0.01"`).
- Dokumen `StockAdjustment` (1 dokumen = 1 gudang): `DRAFT -> POSTED -> CANCELLED`. Jenis `ADJUSTMENT` (user mengisi `qtyChange` +/-, alasan wajib) dan `OPNAME` (user mengisi `qtyActual`; `qtySystem` & selisih diambil **saat Post**). Nomor `ADJ-/OPN-YYYYMM-NNNN` dari koleksi `counters` (`nextDocNo`, di dalam transaksi). Alasan & konstanta: [config/stock.js](backend/config/stock.js) (salinan frontend: `utils/stockMeta.js`); alasan `OTHER` wajib catatan, `OPENING` -> movement `OPENING`.
- SKU/produk yang sudah punya movement **atau** dipakai dokumen stok tidak bisa dihapus (400, arahkan ke nonaktifkan). Gudang dengan saldo/movement/dokumen tidak bisa dihapus; gudang nonaktif tidak bisa dipakai untuk dokumen baru.
- **HPP (average cost)**: `ProdukSku.avgCost`, moving weighted average **per SKU untuk semua gudang**, 2 desimal, `null` = belum diketahui. Dihitung di `applyMovements`: baris dengan `unitCost` (Goods Receipt, dan pembaliknya saat cancel) mengubah HPP; baris lain dicatat dengan `unitCost` = HPP saat itu. Setiap movement menyimpan `unitCost`, `value` (qty x unitCost), `avgCostAfter`. HPP & nilai = data biaya: hanya dikirim ke user dengan `vendorPrice:view` (kartu stok + `canSeeCost`, list SKU, pencarian SKU dokumen, nilai Stock Adjustment: draft = perkiraan perubahan x HPP saat ini, posted = `value` movement-nya, list = `totalValue`).
- **Mengisi HPP stok yang belum punya HPP**: (1) Stock Adjustment alasan **Opening Balance**: baris yang menambah stok bisa diberi `unitCost` (wajib saat post bila SKU belum ber-HPP) dan ikut menghitung HPP rata-rata; hanya diisi/dilihat user dengan `vendorPrice:view` (user lain mengedit draft -> harga pokok yang ada dipertahankan). (2) **Cost Revaluation** ([costRevaluationController](backend/controllers/costRevaluationController.js)): ganti HPP tanpa mengubah stok; post menyimpan `oldCost`, `qty`, `valueChange` per baris + movement `REVALUATION` (qty 0, `value` = saldo gudang x selisih) per gudang; cancel hanya jika HPP SKU belum berubah lagi.
- **Reorder** ([reorderController](backend/controllers/reorderController.js)): `ReorderRule` min/max per **SKU + gudang** (satuan dasar). Status: `OUT` (stok <= 0), `CRITICAL` (stok <= min dan stok + sedang dipesan <= min), `ORDERED` (stok <= min tapi tertutup PO OPEN/PARTIAL), `OK`. Saran = max − (stok + sedang dipesan), dikonversi ke satuan beli vendor utama (dibulatkan ke atas, min. order). SKU/gudang nonaktif diabaikan; hapus SKU/produk/gudang ikut menghapus rule-nya. Rule diaudit (entity `reorderRule`, parent produk).
- **Stock Transfer** ([stockTransferController](backend/controllers/stockTransferController.js)): 2 langkah `DRAFT -> IN_TRANSIT (send) -> RECEIVED`, `IN_TRANSIT -> CANCELLED`. Send = `TRANSFER_OUT` di gudang asal, HPP saat itu disimpan per baris; receive = `TRANSFER_IN` di gudang tujuan dengan unitCost yang sama (nilai hanya berpindah). Terima kurang dari dikirim boleh (selisih = hilang/rusak di perjalanan, catatan wajib, `lossValue`), lebih ditolak. Cancel hanya sebelum diterima (pembalik ke gudang asal); sesudahnya buat transfer balik. Draft/kirim/batal butuh akses gudang asal, terima butuh akses gudang tujuan. Barang **in transit** tidak ada di saldo gudang mana pun: `inTransitSummary()` dipakai valuasi (`totals.inTransit`), dashboard, dan reorder (dihitung "sedang dipesan" di gudang tujuan). Nomor `TRF-YYYYMM-NNNN`.
- Rencana: outlet (POS) menunjuk ke gudang + penugasan kasir -> outlet, dibuat bersama modul POS.

### Pembelian

- **Purchase Order** ([purchaseOrderController](backend/controllers/purchaseOrderController.js)): `DRAFT -> OPEN (terbit, tanpa approval) -> PARTIAL -> RECEIVED`, plus `CLOSED` (sisa tidak akan datang, dari PARTIAL) & `CANCELLED` (dari OPEN, belum ada penerimaan). Hanya DRAFT yang bisa diedit/dihapus; PO terbit diubah dengan cancel + buat ulang. Baris: `sku`, `uomBeli`, `konversi`, `qty`, `hargaBeli`, `diskonPersen` (per baris), `subtotal`, `qtyReceived` (satuan beli). **Satuan beli** hanya satuan dasar produk (konversi 1) atau satuan di daftar harga vendor tsb untuk SKU itu; konversi selalu diisi backend dari sumbernya (input klien diabaikan), satuan lain ditolak (daftarkan dulu di Vendor Prices). SKU + satuan yang sama maks. 1 baris (UI: pilih SKU lagi = baris satuan lain yang belum dipakai, atau fokus ke qty). Harga disalin dari VendorPrice (boleh diubah per PO); `isPKP` & `taxRate` disalin dari System Settings. Tidak mengubah stok. SKU nonaktif tidak bisa dipesan.
- **Goods Receipt** ([goodsReceiptController](backend/controllers/goodsReceiptController.js)): wajib dari PO OPEN/PARTIAL, gudang = gudang PO, banyak GR per PO. Qty melebihi sisa PO **ditolak** (dicek lagi saat post; dua GR bersamaan bentrok lewat `lock(ref('purchaseOrder', id))`). Post = movement `PURCHASE` (`qtyBase = qty x konversi`, `unitCost`) + HPP + `qtyReceived`/status PO + opsional perbarui VendorPrice dari harga PO (diaudit). Cancel = pembalik (HPP dihitung balik), PO yang CLOSED tetap CLOSED. Belum ada retur.
- **HPP masuk per satuan dasar** = harga x (1 − diskon%) [x (1 + PPN%) jika PO non-PKP] / konversi ([helpers/purchaseHelper.js](backend/helpers/purchaseHelper.js)). PKP: PPN tidak masuk HPP.
- PO/GR mengunci & menolak hapus master yang dipakai: Vendor, Gudang, UoM (baris PO), SKU/Produk (`skusWithStockHistory` juga memeriksa baris PO & GR).

### System Settings

- Registri [config/settings.js](backend/config/settings.js) (`key`, `label`, `group`, `type` bool/number/text, `default`, `min`/`max`, `description`); nilai di koleksi `settings` (`_id` = key); baca dengan `getSettings()` ([helpers/settings.js](backend/helpers/settings.js)). Sekarang: `tax.isPKP` (default true), `tax.ppnRate` (default 11). Halaman `/settings` dibangun otomatis dari registri. Dokumen **menyalin** nilai setting saat dibuat/terbit. Perubahan dicatat di audit (entity `setting`, tanpa `entityId`).

### Audit Log

- Koleksi `AuditLog` (append-only; update/delete ditolak oleh hook model): `entity`, `entityId`, `entityLabel` (teks saat itu), `parent` (SKU & harga vendor -> produk), `action` (`create|update|delete|login|login_failed`), `changes: [{ field, label, format, from, to }]` (hanya field yang berubah; relasi `{ id, text }`; password hanya penanda `format: 'secret'` tanpa nilai), `snapshot` (dokumen lengkap saat delete), `batchId` (1 aksi = banyak log, mis. bulk edit / hapus berantai), `user` + `userName`, `ip`, `meta` (alasan login gagal, user agent).
- **Dicatat eksplisit dari controller** lewat [helpers/auditLogger.js](backend/helpers/auditLogger.js) (bukan hook, karena `bulkWrite`/`updateMany` tidak memicu hook):
  ```js
  const before = await audit.snap('vendorPrice', [doc]);   // SEBELUM diubah / dihapus
  await audit.logUpdate(req, 'vendorPrice', before, [doc], { batchId });
  await audit.logCreate(req, 'produkSku', docs);
  await audit.logDelete(req, 'vendorPrice', before, { batchId });
  ```
  Log ditulis **di dalam transaksi yang sama** dengan datanya: gagal menulis log -> seluruh perubahan batal (kecuali log login, yang berdiri sendiri). Simpan ulang tanpa perubahan tidak dicatat.
- Yang dicatat: Produk, ProdukSku (tanpa stok; stok ada di kartu stok), VendorPrice (termasuk vendor yang kehilangan status preferred), Role (izin per resource), User, login (berhasil/gagal), serta Kategori, Vendor, UoM, Variant (nilai: tambah/hapus; urutan saja bukan perubahan), Menu (parent & permission sebagai teks, order), Gudang, Setting, CostRevaluation (baris `SKU: HPP lama -> baru`), PurchaseOrder & GoodsReceipt (GR ber-`parent` PO, histori PO memuat GR-nya; baris sebagai teks `SKU: 10 BOX x 120,000 -5%`), dan StockAdjustment (status, baris sebagai daftar teks `SKU: +5`; Post/Cancel = update status). Definisi field bisa memakai `labels` (kode -> teks) dan format `date` / `stockLines` / `poLines` / `grLines`. **Semua controller yang mengubah data sudah memakai audit.** Entity baru: tambah definisi field di `ENTITIES` (auditLogger), `ENTITY_RESOURCE` ([auditLogController](backend/controllers/auditLogController.js)), dan `ENTITY_META` ([utils/auditFormat.js](frontend/src/utils/auditFormat.js)), lalu panggil helper di controller-nya. **Endpoint baru yang mengubah data entity tsb wajib memanggil audit.**
- Log hanya ada sejak fitur aktif (tidak ada histori sebelumnya); disimpan selamanya.

### Konvensi response

Controller Kategori, Menu, dan Vendor memakai [helpers/responseHelper.js](backend/helpers/responseHelper.js):
```js
{ success: true,  message, data }   // successResponse(res, data, message, status)
{ success: false, message }         // errorResponse(res, message, status)
```
Controller **Auth** masih mengembalikan JSON langsung (format lama). Saat menyentuh controller lama, sesuaikan juga ke helper ini.

### Pola endpoint paginasi (`GET /`)

Query: `search`, `page` (default 1), `pageSize` (default 5), `sortField` (default `createdDate`), `sortOrder` (`asc` | lainnya = desc).
Pencarian memakai `$regex` case-insensitive pada beberapa field, sort memakai collation `en` strength 2.
Bentuk `data`: `{ data<Resource>, totalData, currentPage, totalPages }` (contoh: `dataKategori`).

### Model

Semua model punya field audit: `createdDate`, `createdBy` (ref User), `updatedDate`, `updatedBy`. Controller mengisi `createdBy`/`updatedBy` dari `req.user._id` dan biasanya `populate('createdBy updatedBy', 'name')`.

**Integritas relasi** (MongoDB tidak menjaganya, jadi dicek di controller): hapus Vendor yang masih punya VendorPrice, Kategori/UoM/Variant yang masih dipakai produk (UoM juga sebagai `uomBeli`), menghapus nilai Variant yang dipakai SKU, dan hapus SKU/Produk/Gudang yang punya histori stok -> **ditolak (400)**. Hapus Produk -> ikut hapus SKU & VendorPrice-nya; hapus SKU -> ikut hapus VendorPrice-nya. Produk tanpa varian selalu punya 1 SKU default; jenis varian produk tidak bisa diubah selama masih ada SKU.

| Model | Field utama |
|---|---|
| User | `name`, `email` (unique), `password` (di-hash bcrypt pre-save, `matchPassword()`), `theme` (palet pilihan, null = default), `role` (ref Role), `isActive`, `allGudang` (default true), `gudangs` (ref Gudang[], dipakai jika `allGudang` false) |
| Role | `name` (unique), `deskripsi`, `isSystem` (Super Admin), `permissions` (`[{ resource, actions }]`) |
| Kategori | `name`, `deskripsi` |
| Produk | Induk produk: `name`, `deskripsi`, `kategori` (ref), `uom` (ref Uom, satuan dasar stok & jual), `variants` (ref Variant[], jenis varian; kosong = tanpa varian). **Tidak** menyimpan harga/stok. |
| ProdukSku | Unit yang distok & dijual: `produk`, `sku` (unique, uppercase), `variantValues` (`[{ variant, value }]`, kosong = SKU default), `comboKey` (unique per produk), `hargaJual`, `stok` (cache total semua gudang, baca saja), `avgCost` (HPP, lihat Stok), `isActive` |
| VendorPrice | Harga beli terkini: `vendor`, `produk` (disalin dari SKU), `sku`, `uomBeli` (ref Uom), `konversi` (1 uomBeli = N satuan dasar), `hargaBeli` (per uomBeli), `isPreferred` (maks. 1 per SKU), `minOrder`, `catatan`. Unique `(vendor, sku, uomBeli)`. Harga pokok = `hargaBeli / konversi`. **Konversi harus masuk akal** ([config/uom.js](backend/config/uom.js), [helpers/uomHelper.js](backend/helpers/uomHelper.js)): jenis satuan beli = jenis satuan dasar, atau salah satunya `PACK`; satuan dasar sendiri = konversi 1. Dicek saat simpan harga vendor, ganti satuan dasar produk, dan ganti jenis UoM (ditolak jika membuat harga vendor tidak sah). |
| Vendor | `companyName`, `picName`, `picContact`, `companyAddress` |
| Gudang | `code` (unique, uppercase, mis. `MAIN`), `name`, `alamat`, `provinsi`, `kota` (kota/kabupaten), `kecamatan`, `kodePos` (5 digit), `latitude`/`longitude` (derajat desimal, keduanya diisi atau null, 7 desimal), `deskripsi`, `isActive`. Wilayah masih teks bebas (belum master wilayah). |
| StockBalance | Saldo per `(sku, gudang)` unique: `produk`, `qty` (min. 0). Cache, hanya lewat `applyMovements`. |
| StockMovement | Kartu stok (append-only): `sku`, `produk`, `gudang`, `type` (`OPENING|ADJUSTMENT|OPNAME|PURCHASE|REVALUATION|TRANSFER_OUT|TRANSFER_IN`, nanti SALE/...), `qty` (bertanda), `balanceAfter`, `refType`/`refId`/`refNo`, `reason`, `note`, `isReversal`, `unitCost` (cadangan), `createdBy`, `date` |
| StockAdjustment | `no` (unique), `type` (`ADJUSTMENT|OPNAME`), `gudang`, `date` (tanggal dokumen, tidak boleh masa depan), `reason`, `note`, `status`, `lines: [{ sku, produk, qtySystem, qtyActual, qtyChange, note }]` (SKU unik, maks. 2000), `postedBy/Date`, `cancelledBy/Date`, `cancelReason` |
| StockTransfer | `no` (`TRF-…`), `fromGudang`, `toGudang`, `date`, `note`, `status` (`DRAFT|IN_TRANSIT|RECEIVED|CANCELLED`), `lines: [{ sku, produk, qty, qtyReceived, unitCost, note }]`, `sent*`, `received*`, `receiveNote`, `cancelled*`/`cancelReason` |
| Counter | `_id` = prefix periode (`ADJ-202611`, `PO-…`, `GR-…`), `seq` |
| PurchaseOrder | `no`, `vendor`, `gudang`, `date`, `expectedDate`, `status`, `isPKP`, `taxRate`, `lines` (lihat Pembelian; `_id` per baris), `subtotal`, `taxAmount`, `total`, `note`, `issued*`, `closed*`/`closeReason`, `cancelled*`/`cancelReason` |
| GoodsReceipt | `no`, `purchaseOrder`, `vendor`, `gudang` (disalin dari PO), `date`, `deliveryNoteNo`, `status`, `lines: [{ poLine, sku, produk, uomBeli, konversi, qty, qtyBase, unitCost, note }]`, `posted*`, `cancelled*`/`cancelReason` |
| Setting | `_id` = key, `value`, `updatedDate`, `updatedBy` |
| ReorderRule | `sku`, `produk`, `gudang`, `minQty`, `maxQty` (unique `(sku, gudang)`) |
| CostRevaluation | `no` (`REV-YYYYMM-NNNN`), `date`, `note` (alasan, wajib), `status`, `lines: [{ sku, produk, newCost, oldCost, qty, valueChange, note }]`, `posted*`, `cancelled*`/`cancelReason` |
| Uom | `code` (unique, uppercase, mis. `PCS`), `name`, `type` (`COUNT|WEIGHT|VOLUME|LENGTH|PACK`, wajib untuk UoM baru; null = data lama, tidak dicek), `deskripsi` |
| Variant | `code` (unique, uppercase, mis. `COLOR`), `name`, `values` (array string, min. 1, dinormalisasi: trim + tanpa duplikat), `deskripsi` |
| Menu | `menu`, `parent_id` (ref Menu, hierarki), `component` (path route frontend), `img`, `icon` (class FontAwesome), `deskripsi` (subjudul halaman), `resource` (izin yang dibutuhkan; null = semua user / grup), `order` (urutan di antara saudara; null = paling akhir, lalu nama) |

## Frontend

- [src/main.jsx](frontend/src/main.jsx): `BrowserRouter` + `AuthProvider`.
- [src/App.jsx](frontend/src/App.jsx) memakai layout route:
  - `PublicLayout` (`/login`; tidak ada halaman register): user yang sudah login diarahkan ke `/`.
  - `ProtectedLayout` (`/`, `/kategori`, `/produk`, `/produk/:id`, `/menu`, `/vendor`, `/uom`, `/variant`, `/gudang`, `/stock-adjustment`, `/stock-adjustment/:id`, `/stock-transfer`, `/stock-transfer/:id`, `/stock-movement`, `/stock-valuation`, `/reorder`, `/cost-revaluation`, `/cost-revaluation/:id`, `/purchase-order`, `/purchase-order/:id`, `/goods-receipt`, `/goods-receipt/:id`, `/settings`, `/users`, `/roles`, `/audit-log`, `/appearance`, `*` → `NotFound`): belum login diarahkan ke `/login` (dengan `state.from`, setelah login kembali ke halaman tujuan), lalu dibungkus `MainLayout`. Halaman data dibungkus `guard(resource, ...)` ([RequirePermission](frontend/src/components/RequirePermission.jsx)): tanpa izin view -> halaman Access denied (403).
  - **Produk**: halaman daftar (`/produk`) hanya info induk + ringkasan SKU; tombol Detail membuka [ProdukDetail](frontend/src/pages/ProdukDetail.jsx) (`/produk/:id?tab=info|sku|stock|prices|history`): tab Info, **Variants & SKU** (generator kombinasi + tabel SKU editable dengan harga pokok & margin; stok baca saja), **Stock** (saldo per SKU x gudang, kolom SKU & Total menempel saat digeser; klik angka -> kartu stok di drawer [StockCardDrawer](frontend/src/components/produk/StockCardDrawer.jsx), state di URL `?tab=stock&sku=&gudang=`; izin `stockMovement:view`), **Vendor Prices** (hanya jika izin `vendorPrice:view`), **History** (audit log produk + SKU + harga vendor). Komponen di `src/components/produk/`. Halaman turunan memakai `PageHeader parentPath="/produk" title=...` untuk breadcrumb; sidebar menandai menu induk aktif untuk path turunannya.
  - **Audit Log**: komponen di `src/components/audit/`: `AuditTimeline` (histori 1 record, dikelompokkan per `batchId`, Load more), `AuditHistorySection` (bagian History yang bisa dibuka di drawer; pasang lewat prop `aside` FormDrawer supaya tetap bisa diklik di mode Detail), `AuditChanges`. Dipakai di tab History ProdukDetail, drawer semua halaman master data lewat `aside={historyAside(crud, '<entity>')}` ([utils/historyAside.jsx](frontend/src/utils/historyAside.jsx)), dan halaman [AuditLog](frontend/src/pages/AuditLog.jsx) (`/audit-log`).
  - **Stok** (komponen di `src/components/stock/`, service [stockService.js](frontend/src/services/stockService.js)): [StockAdjustment](frontend/src/pages/StockAdjustment.jsx) (daftar dokumen + filter; tombol New Adjustment / New Stock Opname), [StockAdjustmentDetail](frontend/src/pages/StockAdjustmentDetail.jsx) (`/stock-adjustment/new?type=ADJUSTMENT|OPNAME` atau `/:id`: header, baris SKU dengan `SkuPicker` lintas produk, opname bisa muat semua SKU per produk/kategori, Enter pindah baris, Save draft / Save & Post / Delete / Cancel dengan alasan, History), [StockTransfer](frontend/src/pages/StockTransfer.jsx) / [StockTransferDetail](frontend/src/pages/StockTransferDetail.jsx) (`/stock-transfer/new` atau `/:id`: gudang asal hanya yang ditugaskan, Save & Send, Receive dengan qty diterima per baris + catatan selisih, Cancel selama in transit; query URL `?status=`), [StockMovement](frontend/src/pages/StockMovement.jsx) (kartu stok global; query URL awal `search|gudang|sku|label`; kolom Unit cost / Value / HPP after jika `canSeeCost`), [StockValuation](frontend/src/pages/StockValuation.jsx) (`/stock-valuation`, guard `vendorPrice`: ringkasan nilai, grup SKU/Product/Category/Warehouse, Export CSV, kolom HPP status, filter "Show these SKU" = hanya SKU tanpa HPP), [CostRevaluationDetail](frontend/src/pages/CostRevaluationDetail.jsx) (`/cost-revaluation/new?missing=1` memuat semua SKU berstok tanpa HPP; `SkuPicker searchFn=`). Stock Adjustment alasan Opening Balance: kolom Unit cost (hanya `vendorPrice:view`). Tabel SKU: kolom **HPP** (avgCost; jika kosong perkiraan harga vendor bertanda `est.`) dan margin dari HPP. Halaman [Gudang](frontend/src/pages/Gudang.jsx) mengikuti pola master data.
  - **Pembelian** (service [purchaseService.js](frontend/src/services/purchaseService.js), komponen `src/components/purchase/`): [PurchaseOrderDetail](frontend/src/pages/PurchaseOrderDetail.jsx) (`/purchase-order/new` atau `/:id`: `PoItemPicker` (tab Item vendor ini / Semua SKU) dengan harga vendor, ★ = satuan yang punya harga vendor, peringatan min. order & harga beda daftar, total + PPN, Save draft / Save & Issue / Cancel / Close / Receive), [GoodsReceiptDetail](frontend/src/pages/GoodsReceiptDetail.jsx) (`/goods-receipt/new?po=` atau pilih PO; qty default = sisa, Fill/Clear, opsi perbarui harga vendor, HPP & nilai hanya jika `vendorPrice:view`). Status: `utils/purchaseMeta.js` + `StatusBadge meta=`. Panel alasan cancel/close: `components/stock/ReasonPanel`. [Settings](frontend/src/pages/Settings.jsx) (`/settings`).
  - **Dashboard** ([Dashboard.jsx](frontend/src/pages/Dashboard.jsx)): KPI, pekerjaan tertunda (draft & PO terlambat), reorder alert, grafik nilai per gudang/kategori, pembelian 6 bulan, pergerakan 30 hari, aktivitas terbaru. Grafik tanpa library di [components/dashboard/Charts.jsx](frontend/src/components/dashboard/Charts.jsx) (`BarList`, `ColumnChart`, `InOutChart`: satu warna `primary`, hover readout + `<title>`, tabel data di `<details>`).
  - **Reorder** ([Reorder.jsx](frontend/src/pages/Reorder.jsx)): daftar alert + rencana pesan per baris (vendor, UoM, konversi, qty, harga) -> Create PO. Min/max diatur di tab Stock detail produk ("Edit reorder levels"). Badge lonceng di Navbar ([ReorderBadge](frontend/src/components/ReorderBadge.jsx)).
  - Halaman baru cukup ditambahkan sebagai child `ProtectedLayout` **dan** dibuat datanya di Menu (`component` = path) agar muncul di sidebar. Halaman tidak perlu cek `user` sendiri.
- Auth state: [src/context/AuthContext.jsx](frontend/src/context/AuthContext.jsx) (`useAuth()` → `{ user, login, logout, updateUser, refreshUser, sessionExpired }`; `user.role`, `user.permissions` = `{ produk: ['view', ...] }`, dimuat ulang dari `/api/auth/me` saat aplikasi dibuka & saat menerima 403). Cek izin di UI: `usePermission(resource)` → `{ loaded, canView, canCreate, canUpdate, canDelete, canPost }` (hanya tampilan; penegakan di backend), disimpan di `localStorage` key `user`. `user.token` dipakai untuk request API. Token yang `exp`-nya sudah lewat dibuang saat aplikasi dimuat.
- [src/utils/axiosSetup.js](frontend/src/utils/axiosSetup.js) (di-import di `main.jsx`): interceptor axios global: 401 (selain login) → logout otomatis + pesan "sesi berakhir"; 403 → izin dimuat ulang (tanpa logout).
- `src/services/*Service.js`: wrapper axios per resource, menerima `token` dan menambahkan header Bearer. Path API relatif (`/api/...`) lewat proxy Vite.
- `src/pages/`: satu halaman per resource. Semua halaman master data (Menu, Kategori, Produk, Vendor, UoM, Variant) memakai pola yang sama, ikuti [pages/Kategori.jsx](frontend/src/pages/Kategori.jsx) sebagai contoh paling sederhana:
  - [hooks/useDataTable.js](frontend/src/hooks/useDataTable.js): search (debounce 500 ms), paginasi, sort, loading. `fetcher` dibungkus `useCallback([user.token])` dan mengembalikan `{ items, total }`.
  - [hooks/useCrudDrawer.js](frontend/src/hooks/useCrudDrawer.js): state drawer, form, simpan (`prepare` untuk validasi), hapus dengan konfirmasi, **izin** (opsi `resource`, `canEditRow`, `canDeleteRow`), dan 3 mode: Add, Edit, **Detail** (baca saja). Pakai `onAdd={crud.addHandler}` (null = tombol Add disembunyikan), `actionColumn(crud)` (tombol Detail selalu ada, Edit/Delete sesuai izin), dan `<FormDrawer {...crud.drawerProps}>` (mode Detail mengunci semua field lewat `<fieldset disabled>`, tombol Edit jika diizinkan).
  - Judul halaman **tidak di-hardcode**: [PageHeader](frontend/src/components/PageHeader.jsx) mengambil judul, ikon, subjudul (`Menu.deskripsi`), dan breadcrumb (hierarki parent) dari data Menu untuk route aktif lewat `usePageMeta`, sekaligus mengatur judul tab (`<judul> · MERN App`). Halaman cukup memberi `fallbackTitle` untuk route yang belum ada di Menu.
  - Data pohon menu dimuat sekali oleh [MenuProvider](frontend/src/context/MenuProvider.jsx) (di `ProtectedLayout`), dipakai bersama Sidebar dan PageHeader via `useMenus()`. Panggil `reloadMenus()` setelah data Menu diubah.
  - [components/DataPage.jsx](frontend/src/components/DataPage.jsx): header + toolbar (search & tombol Add sejajar) + `DataTable` + `Pagination`; form ditaruh sebagai children dalam `FormDrawer`.
  - `DataTable`: lebar kolom tetap (`width` per kolom), tinggi header tetap, teks panjang dipotong "…" dan bisa diklik (`TruncateText`). Kolom standar dari [utils/tableColumns.jsx](frontend/src/utils/tableColumns.jsx): `auditColumn(sortField)` (Last Modified, menu sort created/updated) dan `actionColumn({ onEdit, onDelete })`.
  - Form: `FormField` + `inputClass` dari `utils/formStyles.js`; saat edit tampilkan `<AuditDetail data={editingRow} />`. Pilihan dari resource lain (select) pakai endpoint `/dropdown`, bukan `/all`.
- Tambah baris dokumen: [ItemCombobox](frontend/src/components/ItemCombobox.jsx) (tombol -> panel search + tab + daftar scroll, di-portal ke body, tetap terbuka setelah memilih, item yang sudah ada ditandai "added"); dipakai `SkuPicker` (Stock Adjustment, Stock Transfer, Cost Revaluation) dan `PoItemPicker`.
- Drawer: `FormDrawer` untuk form; [SideDrawer](frontend/src/components/SideDrawer.jsx) untuk panel baca saja (gaya sama, prop `header` untuk pemilih yang tetap terlihat).
- **Notifikasi: jangan pakai `alert()` / `confirm()` bawaan browser.** Pakai `useToast()` (`toast.success/error/warning/info(msg)`, pojok kanan atas, hilang otomatis) dan `useConfirm()` (`await confirm({ title, message, confirmLabel, tone: 'danger' })` → boolean). Provider dipasang di `main.jsx`. `useCrudDrawer` sudah memakainya untuk simpan/hapus.
- Layout: [MainLayout](frontend/src/layouts/MainLayout.jsx) = `Navbar` + `Sidebar` + konten. Tombol ☰ di Navbar: layar ≥ 1024px menyembunyikan/menampilkan sidebar (diingat di `localStorage` key `sidebarHidden`), layar kecil membuka sidebar sebagai drawer. `Sidebar` membaca pohon menu dari `useMenus()` dan merender lewat `SidebarMenu` (highlight via `useLocation`, parent dari menu aktif otomatis terbuka). Halaman Menu memanggil `reloadMenus()` setelah simpan/hapus, jadi sidebar dan judul langsung ter-update.
- Utilitas: [src/utils/dateHelper.js](frontend/src/utils/dateHelper.js) (`formatDate` locale id-ID, `formatDate2` via dayjs `DD MMM YYYY HH:mm`, `formatDay` `DD MMM YYYY`, `toDateInput` untuk `<input type="date">`).
- Styling: Tailwind CSS 4 (plugin `@tailwindcss/vite`), ikon FontAwesome dan `@tabler/icons-react`, animasi `framer-motion`.
- **Tema / palet** (halaman `/appearance`, ikon 🎨 di Navbar):
  - **Jangan pakai warna Tailwind langsung** (`bg-blue-600`, `text-gray-700`, ...). Pakai token semantik dari [src/index.css](frontend/src/index.css): `bg-page`, `bg-surface`, `bg-subtle`, `text-fg`, `text-muted`, `border-line`, `border-line-soft`, `bg-primary`/`hover:bg-primary-hover`/`text-primary-fg`, `bg-primary-soft`, `bg-nav*`, `bg-side*`, `bg-head`, `bg-highlight`, `text-danger`/`bg-danger-soft`, `bg-warning-soft`, `bg-success-soft`. Teks di atas `bg-primary` selalu `text-primary-fg` (bukan `text-white`, karena tema gelap memakai primary terang).
  - Tema = atribut `data-theme` di `<html>`; tiap tema hanya mengisi ulang variabel `--t-*`. Default `slate-indigo`.
  - Menambah tema: blok `[data-theme="..."]` di `index.css` + entri di [src/theme/themes.js](frontend/src/theme/themes.js) + `ALLOWED_THEMES` di `backend/controllers/authController.js`.
  - Pilihan disimpan per user (`User.theme`, `PUT /api/auth/theme`) dan disalin ke `localStorage` key `theme`; script di `index.html` menerapkannya sebelum React render agar tidak berkedip. State: `ThemeProvider` / `useTheme()`.

## Konvensi

- Penamaan campuran Indonesia/Inggris: nama resource dan field berbahasa Indonesia (`kategori`, `produk`, `deskripsi`, `harga`), pesan response terbaru berbahasa Inggris ("Category successfully added").
- Branch utama: `main`; pengembangan fitur di branch terpisah (mis. `vendorMenu`) lalu di-merge.
- Jangan commit isi `backend/.env`.
