# mern-app

Aplikasi admin full-stack MERN (MongoDB, Express, React, Node.js) untuk mengelola data master (**Kategori, Produk, Vendor, UoM, Variant, Menu**), dengan autentikasi JWT dan otorisasi berbasis role (RBAC: **User, Role**). Sidebar aplikasi dibangun secara dinamis dari data Menu di database.

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
npm run dev      # node --watch app.js, auto-restart saat file berubah
npm start        # node app.js
npm run seed:rbac  # migrasi RBAC (idempotent): role Super Admin -> admin@mern.com, tautkan Menu ke resource, buat menu User, Role & Audit Log
npm run migrate:produk-sku  # migrasi produk lama (idempotent): UoM PCS, 1 SKU default per produk (harga -> hargaJual, qty -> stok)
npm run rs:init  # inisialisasi replica set 1 node (idempotent; biasanya lewat setup-replica-set.ps1)
```
Butuh `backend/.env` dengan `MONGO_URI`, `JWT_SECRET`, `PORT` (default 5000).

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
```

Belum ada test di kedua sisi.

## Backend

- Entry: [backend/app.js](backend/app.js): CORS, JSON body, header `Cache-Control: no-store` untuk semua response, lalu mount route.
- Pola per resource: `models/` → `controllers/` → `routes/`.
- Route yang terdaftar:
  - `/api/auth`: `POST /login` (publik), `GET /me` (profil + role + izin efektif), `PUT /theme`. **Registrasi publik dimatikan**; user dibuat admin lewat `/api/user`.
  - `/api/kategori`, `/api/vendor`, `/api/produk`, `/api/uom`, `/api/variant`: `GET /dropdown`, `GET /all`, `GET /` (paginasi), `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id`
  - `/api/menu`: `GET /tree` (sidebar, disaring sesuai izin user), `GET /dropdown`, `GET /all`, `GET /` (paginasi), `GET /getHierarchy`, `POST`, `PUT /:id`, `DELETE /:id`
  - `/api/role`: `GET /resources` (registri untuk matriks), `GET /dropdown`, CRUD standar. `/api/user`: CRUD standar (tanpa `/all`).
  - `/api/produk/:id/sku`: `GET` (list SKU + harga pokok jika boleh lihat harga vendor), `POST /generate` (kombinasi varian), `PUT` (bulk update), `DELETE /:skuId`. Mengelola SKU butuh izin `produk:update`.
  - `/api/audit-log` (baca saja): `GET /history?entity=produk|role|user|kategori|vendor|uom|variant|menu&id=` (histori 1 record, izin = view resource record tsb; produk ikut memuat SKU & harga vendornya, user ikut memuat riwayat login), `GET /` (halaman global, izin `auditLog:view`, filter `search|entity|action|from|to`). Isi selalu disaring sesuai izin view per resource (log harga vendor butuh `vendorPrice:view`).
  - `/api/vendor-price`: `GET ?produk=|vendor=|sku=` (salah satu wajib; tiap baris + `hargaPerUnit`), `POST` (banyak SKU sekaligus, upsert per vendor+sku+uomBeli), `PUT /:id`, `DELETE /:id`. Izin resource `vendorPrice` (terpisah dari `produk`, karena harga beli sensitif).
- Auth: [middlewares/authMiddleware.js](backend/middlewares/authMiddleware.js) (`protect`) memvalidasi `Authorization: Bearer <token>`, mengisi `req.user` (tanpa password, **role sudah di-populate**), menolak user yang dihapus atau `isActive: false` (401). Token dibuat oleh [utils/generateToken.js](backend/utils/generateToken.js) (berlaku 7 hari).

### Otorisasi (RBAC)

- Satu user = satu role (`User.role`). Izin disimpan di `Role.permissions: [{ resource, actions }]`, action: `view` (buka menu, tabel, search, detail), `create`, `update`, `delete`. Action selain `view` hanya sah jika `view` juga ada.
- Registri resource: [config/permissions.js](backend/config/permissions.js) (sumber kebenaran; juga dikirim ke frontend lewat `GET /api/role/resources`).
- **Setiap endpoint data wajib `protect` + `authorize(resource, action)`** ([middlewares/authorize.js](backend/middlewares/authorize.js)); tanpa izin -> **403** (bukan 401). Pola route: `GET /`, `GET /:id`, `GET /all` -> view; `POST` -> create; `PUT` -> update; `DELETE` -> delete.
- `GET /dropdown` cukup `protect` (tanpa izin view), untuk pilihan di form resource lain; **hanya field ringkas** (`_id` + `name`/`code`) via `dropdownHandler` di [helpers/dropdownHelper.js](backend/helpers/dropdownHelper.js). Daftarkan sebelum `/:id`.
- Role `isSystem` (Super Admin) melewati semua cek, tidak bisa diubah/dihapus. Backend mencegah: hapus role yang masih dipakai, ubah role/nonaktifkan/hapus akun sendiri, dan kehilangan Super Admin aktif terakhir.
- `Menu.resource` menautkan menu ke resource: sidebar (`/api/menu/tree`) hanya memuat menu yang boleh di-view; menu tanpa resource tapi punya route = semua user; menu grup tampil jika ada anak yang tampil.
- Resource boleh membatasi action-nya (`actions: ['view']`, mis. `auditLog`); matriks Role menampilkan "–" untuk action yang tidak berlaku.
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
  - `preferred:<skuId>`: maks. 1 vendor utama per SKU. `superadmin`: min. 1 Super Admin aktif.
  - Modul stok nanti: pengurangan stok pakai update atomik bersyarat (`{ stok: { $gte: qty } }` + `$inc`) di dalam transaksi.

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
- Yang dicatat: Produk, ProdukSku, VendorPrice (termasuk vendor yang kehilangan status preferred), Role (izin per resource), User, login (berhasil/gagal), serta Kategori, Vendor, UoM, Variant (nilai: tambah/hapus; urutan saja bukan perubahan), dan Menu (parent & permission sebagai teks). **Semua controller yang mengubah data sudah memakai audit.** Entity baru: tambah definisi field di `ENTITIES` (auditLogger), `ENTITY_RESOURCE` ([auditLogController](backend/controllers/auditLogController.js)), dan `ENTITY_META` ([utils/auditFormat.js](frontend/src/utils/auditFormat.js)), lalu panggil helper di controller-nya. **Endpoint baru yang mengubah data entity tsb wajib memanggil audit.**
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

**Integritas relasi** (MongoDB tidak menjaganya, jadi dicek di controller): hapus Vendor yang masih punya VendorPrice, Kategori/UoM/Variant yang masih dipakai produk (UoM juga sebagai `uomBeli`), dan menghapus nilai Variant yang dipakai SKU -> **ditolak (400)**. Hapus Produk -> ikut hapus SKU & VendorPrice-nya; hapus SKU -> ikut hapus VendorPrice-nya. Produk tanpa varian selalu punya 1 SKU default; jenis varian produk tidak bisa diubah selama masih ada SKU.

| Model | Field utama |
|---|---|
| User | `name`, `email` (unique), `password` (di-hash bcrypt pre-save, `matchPassword()`), `theme` (palet pilihan, null = default), `role` (ref Role), `isActive` |
| Role | `name` (unique), `deskripsi`, `isSystem` (Super Admin), `permissions` (`[{ resource, actions }]`) |
| Kategori | `name`, `deskripsi` |
| Produk | Induk produk: `name`, `deskripsi`, `kategori` (ref), `uom` (ref Uom, satuan dasar stok & jual), `variants` (ref Variant[], jenis varian; kosong = tanpa varian). **Tidak** menyimpan harga/stok. |
| ProdukSku | Unit yang distok & dijual: `produk`, `sku` (unique, uppercase), `variantValues` (`[{ variant, value }]`, kosong = SKU default), `comboKey` (unique per produk), `hargaJual`, `stok`, `isActive` |
| VendorPrice | Harga beli terkini: `vendor`, `produk` (disalin dari SKU), `sku`, `uomBeli` (ref Uom), `konversi` (1 uomBeli = N satuan dasar), `hargaBeli` (per uomBeli), `isPreferred` (maks. 1 per SKU), `minOrder`, `catatan`. Unique `(vendor, sku, uomBeli)`. Harga pokok = `hargaBeli / konversi`. |
| Vendor | `companyName`, `picName`, `picContact`, `companyAddress` |
| Uom | `code` (unique, uppercase, mis. `PCS`), `name`, `deskripsi` |
| Variant | `code` (unique, uppercase, mis. `COLOR`), `name`, `values` (array string, min. 1, dinormalisasi: trim + tanpa duplikat), `deskripsi` |
| Menu | `menu`, `parent_id` (ref Menu, hierarki), `component` (path route frontend), `img`, `icon` (class FontAwesome), `deskripsi` (subjudul halaman), `resource` (izin yang dibutuhkan; null = semua user / grup) |

## Frontend

- [src/main.jsx](frontend/src/main.jsx): `BrowserRouter` + `AuthProvider`.
- [src/App.jsx](frontend/src/App.jsx) memakai layout route:
  - `PublicLayout` (`/login`; tidak ada halaman register): user yang sudah login diarahkan ke `/`.
  - `ProtectedLayout` (`/`, `/kategori`, `/produk`, `/produk/:id`, `/menu`, `/vendor`, `/uom`, `/variant`, `/users`, `/roles`, `/audit-log`, `/appearance`, `*` → `NotFound`): belum login diarahkan ke `/login` (dengan `state.from`, setelah login kembali ke halaman tujuan), lalu dibungkus `MainLayout`. Halaman data dibungkus `guard(resource, ...)` ([RequirePermission](frontend/src/components/RequirePermission.jsx)): tanpa izin view -> halaman Access denied (403).
  - **Produk**: halaman daftar (`/produk`) hanya info induk + ringkasan SKU; tombol Detail membuka [ProdukDetail](frontend/src/pages/ProdukDetail.jsx) (`/produk/:id?tab=info|sku|prices|history`): tab Info, **Variants & SKU** (generator kombinasi + tabel SKU editable dengan harga pokok & margin), **Vendor Prices** (hanya jika izin `vendorPrice:view`), **History** (audit log produk + SKU + harga vendor). Komponen di `src/components/produk/`. Halaman turunan memakai `PageHeader parentPath="/produk" title=...` untuk breadcrumb; sidebar menandai menu induk aktif untuk path turunannya.
  - **Audit Log**: komponen di `src/components/audit/`: `AuditTimeline` (histori 1 record, dikelompokkan per `batchId`, Load more), `AuditHistorySection` (bagian History yang bisa dibuka di drawer; pasang lewat prop `aside` FormDrawer supaya tetap bisa diklik di mode Detail), `AuditChanges`. Dipakai di tab History ProdukDetail, drawer semua halaman master data lewat `aside={historyAside(crud, '<entity>')}` ([utils/historyAside.jsx](frontend/src/utils/historyAside.jsx)), dan halaman [AuditLog](frontend/src/pages/AuditLog.jsx) (`/audit-log`).
  - Halaman baru cukup ditambahkan sebagai child `ProtectedLayout` **dan** dibuat datanya di Menu (`component` = path) agar muncul di sidebar. Halaman tidak perlu cek `user` sendiri.
- Auth state: [src/context/AuthContext.jsx](frontend/src/context/AuthContext.jsx) (`useAuth()` → `{ user, login, logout, updateUser, refreshUser, sessionExpired }`; `user.role`, `user.permissions` = `{ produk: ['view', ...] }`, dimuat ulang dari `/api/auth/me` saat aplikasi dibuka & saat menerima 403). Cek izin di UI: `usePermission(resource)` → `{ loaded, canView, canCreate, canUpdate, canDelete }` (hanya tampilan; penegakan di backend), disimpan di `localStorage` key `user`. `user.token` dipakai untuk request API. Token yang `exp`-nya sudah lewat dibuang saat aplikasi dimuat.
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
- **Notifikasi: jangan pakai `alert()` / `confirm()` bawaan browser.** Pakai `useToast()` (`toast.success/error/warning/info(msg)`, pojok kanan atas, hilang otomatis) dan `useConfirm()` (`await confirm({ title, message, confirmLabel, tone: 'danger' })` → boolean). Provider dipasang di `main.jsx`. `useCrudDrawer` sudah memakainya untuk simpan/hapus.
- Layout: [MainLayout](frontend/src/layouts/MainLayout.jsx) = `Navbar` + `Sidebar` + konten. Tombol ☰ di Navbar: layar ≥ 1024px menyembunyikan/menampilkan sidebar (diingat di `localStorage` key `sidebarHidden`), layar kecil membuka sidebar sebagai drawer. `Sidebar` membaca pohon menu dari `useMenus()` dan merender lewat `SidebarMenu` (highlight via `useLocation`, parent dari menu aktif otomatis terbuka). Halaman Menu memanggil `reloadMenus()` setelah simpan/hapus, jadi sidebar dan judul langsung ter-update.
- Utilitas: [src/utils/dateHelper.js](frontend/src/utils/dateHelper.js) (`formatDate` locale id-ID, `formatDate2` via dayjs `DD MMM YYYY HH:mm`).
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
