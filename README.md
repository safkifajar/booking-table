# Booking Table — RATS Social / SOHO Social House

Aplikasi social table booking: buka meja, undang teman, pesan bersama, bagi tagihan. Dilengkapi panel admin, mode staff (waiter & kasir), membership, dan pembayaran QRIS.

Stack: **Next.js 16** · **React 19** · **TypeScript** · **Tailwind v4** · **PostgreSQL 16** · **Drizzle ORM** · **Auth.js v5**

---

## Prasyarat

- Node.js 24 LTS
- Docker (untuk PostgreSQL lokal) atau PostgreSQL 16 yang sudah terpasang
- npm

---

## Setup Lokal

### 1. Nyalakan database

```bash
docker compose up -d
```

Menjalankan PostgreSQL 16 di `localhost:5432` dan Adminer di `localhost:8080` untuk melihat isi tabel.

### 2. Siapkan environment

```bash
cp .env.example .env.local
```

Yang wajib diisi supaya aplikasi jalan:

| Variabel | Keterangan |
|---|---|
| `DATABASE_URL` | Default docker compose: `postgres://postgres:postgres_dev_only@localhost:5432/booking_table` |
| `AUTH_SECRET` | Generate dengan `npx auth secret` |
| `AUTH_URL` | Dev: `http://localhost:3000` |
| `NEXT_PUBLIC_BAR_SLUG` | `soho-purwokerto` |

Sisanya opsional untuk pengembangan lokal: Resend (email), Duitku (pembayaran), VAPID (push notification), Sentry (pemantauan error). Penjelasan tiap variabel ada di komentar `.env.example`.

### 3. Siapkan skema database

```bash
bash scripts/pre-migrate.sh    # DDL yang harus jalan lebih dulu
npm run db:push                # sinkronkan skema tabel dari src/lib/db/schema
bash scripts/apply-sql.sh      # function, trigger, dan constraint
```

Ketiganya harus dijalankan berurutan. `db:push` hanya menyinkronkan struktur tabel, sedangkan function, trigger, dan constraint anti double-booking hidup di file SQL bernomor di folder `drizzle/`. Melewati langkah ketiga membuat panel admin gagal memuat dan race condition double-booking lolos.

### 4. Isi data awal

```bash
npm run db:seed
```

Idempoten, aman diulang. Mengisi bar, area lantai, meja, dan menu.

### 5. Buat akun admin

```bash
npx tsx scripts/create-admin.ts owner@example.com 'PasswordKuat123!' "Owner"
```

Idempoten juga. Email baru akan dibuatkan akun, email yang sudah ada akan direset passwordnya dan dipastikan berperan admin.

### 6. Jalankan

```bash
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000). Panel admin di `/admin-login`, mode staff di `/staff`.

---

## Perintah

| Perintah | Kegunaan |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Build produksi |
| `npm start` | Jalankan hasil build |
| `npm run lint` | ESLint |
| `npm run db:push` | Sinkronkan skema tabel ke database |
| `npm run db:seed` | Isi data awal |
| `npx drizzle-kit generate` | Buat file migrasi dari perubahan skema |
| `npx drizzle-kit studio` | Jelajahi data lewat antarmuka web |

---

## Peran Pengguna

| Peran | Masuk lewat | Bisa apa |
|---|---|---|
| Tamu / member | `/auth` | Buka meja, gabung meja, pesan, bagi tagihan, teman, cerita, membership |
| Waiter | `/staff` | Terima pesanan, kelola meja |
| Kasir | `/staff/cashier` | Pembayaran, struk, tutup shift, data pelanggan |
| Manager | `/admin-login` | Sebagian besar panel admin |
| Admin | `/admin-login` | Seluruh panel admin termasuk Email Log dan staff |

Peran staff disimpan di tabel `staff_roles` dengan nilai `waiter`, `cashier`, `manager`, dan `admin`.

---

## Struktur Project

```
src/
├── app/
│   ├── page.tsx              # Landing
│   ├── auth/                 # Masuk, lupa & reset password
│   ├── bar/[slug]/           # Denah lantai
│   ├── open-table/           # Form buka meja
│   ├── session/[id]/         # Meja aktif: anggota, menu, tagihan, bagi bayar
│   ├── booking/[id]/pay/     # Pembayaran reservasi
│   ├── profile/              # Profil, teman, cerita, sesi login, privasi
│   ├── network/              # Jejaring antar member
│   ├── membership/           # Tingkat membership & voucher
│   ├── promo/                # Banner promo
│   ├── qr/[tableId]/         # Masuk lewat QR meja
│   ├── staff/                # Waiter & kasir
│   ├── admin/                # Panel admin (30+ halaman)
│   └── api/
│       ├── auth/             # Auth.js
│       ├── realtime/         # SSE per bar, sesi, staff, user
│       ├── payments/duitku/  # Callback gateway
│       └── cron/             # Pengingat booking, notifikasi banner, kedaluwarsa cerita
├── lib/
│   ├── db/                   # Drizzle client & schema (45 tabel, 18 enum)
│   ├── auth-v2/              # Helper autentikasi
│   ├── realtime/             # LISTEN/NOTIFY Postgres untuk SSE
│   ├── payments/             # Driver mock & Duitku
│   ├── storage/              # Driver penyimpanan berkas
│   ├── actions.ts            # Server action inti
│   ├── queries.ts            # Pengambilan data sisi server
│   └── *-actions.ts          # Server action per modul
├── components/
├── hooks/
└── middleware.ts             # Penjagaan rute
```

---

## Realtime

Memakai **Server-Sent Events** di atas **LISTEN/NOTIFY PostgreSQL**, bukan layanan realtime pihak ketiga.

- `src/lib/realtime/listener.ts` memegang koneksi Postgres khusus untuk LISTEN, terpisah dari pool Drizzle supaya query biasa tidak kehabisan slot koneksi
- `src/lib/realtime/notify.ts` mengirim notifikasi saat data berubah
- Endpoint SSE tersedia per bar, per sesi, per staff, dan per pengguna di `src/app/api/realtime/`

---

## Pembayaran

Diatur lewat `PAYMENT_GATEWAY`:

- `mock` — pembayaran ditandai lunas secara manual, dipakai untuk demo dan pengembangan
- `duitku` — QRIS sungguhan, butuh `DUITKU_MERCHANT_CODE`, `DUITKU_API_KEY`, dan `DUITKU_CALLBACK_URL` yang juga didaftarkan di dashboard Duitku

`NEXT_PUBLIC_DEMO_MODE=true` membuat seluruh pembayaran otomatis lunas. Wajib `false` di produksi.

---

## Penyimpanan Berkas

Avatar dan cerita disimpan lewat driver di `src/lib/storage/`, diatur `STORAGE_DRIVER`. Default `local`. Di produksi isi `UPLOADS_DIR` dengan folder di luar project, misalnya `/var/lib/booking-table/uploads`, supaya berkas tidak ikut terbundel saat build dan tidak hilang saat deploy berikutnya.

---

## Database

45 tabel dan 18 enum, didefinisikan di `src/lib/db/schema/`. Modul besarnya: sesi meja dan anggota, pesanan dan item, pembayaran dan pembagian tagihan, membership dan voucher, teman dan blokir, cerita, notifikasi dan push, banner, log aktivitas, log email, serta permintaan hapus akun.

Folder `drizzle/` berisi 61 file SQL. Sebagian hanya jejak riwayat migrasi, sebagian lagi berisi function, trigger, dan constraint yang dijalankan `scripts/apply-sql.sh` setiap deploy.

---

## Skrip Bantu

| Skrip | Kegunaan |
|---|---|
| `scripts/deploy.sh` | Deploy ke VPS: sync, install, migrasi, build, reload PM2 |
| `scripts/setup-production.sh` | Penyiapan awal server |
| `scripts/pre-migrate.sh` | DDL yang harus jalan sebelum `db:push` |
| `scripts/apply-sql.sh` | Function, trigger, dan constraint setelah `db:push` |
| `scripts/create-admin.ts` | Buat atau promosikan akun admin |
| `scripts/seed.ts` | Data awal |
| `scripts/reset-menu-dev.ts` | Reset menu saat pengembangan |
| `scripts/test-*.ts` | Skrip verifikasi manual per modul, dijalankan dengan `npx tsx` |

Skrip `test-*.ts` adalah pemeriksaan manual, bukan test otomatis. Project ini belum punya kerangka pengujian.

---

## Deploy

Panduan lengkap ada di [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): Hostinger KVM VPS, Ubuntu 22.04 atau 24.04, nginx, Let's Encrypt, PM2, dan ufw. Termasuk pengaturan dua environment staging dan production di satu server.

Deploy rutin cukup `bash scripts/deploy.sh`. Urutannya: sync branch, `npm ci`, pre-migrate, `db:push --force`, apply-sql, build, lalu reload PM2. Build yang gagal menghentikan proses sebelum PM2 di-reload, sehingga versi lama tetap berjalan.

---

## Dokumen Lain

Folder `docs/` berisi PRD per fitur: bagi hasil, rework pembayaran berbasis tagihan, email transaksi, teman, split QRIS oleh host, kontrol pesanan host, membership, dan multi order prepaid.

Catatan: [docs/schema.md](docs/schema.md) masih menggambarkan skema 13 tabel dari era Supabase dan belum diperbarui ke skema 45 tabel yang berlaku sekarang. Acuan skema yang sahih ada di `src/lib/db/schema/`.

---

## Troubleshooting

**Panel admin error 500 setelah setup**
Function dan trigger belum terpasang. Jalankan `bash scripts/apply-sql.sh`.

**`db:push` menggantung menunggu jawaban prompt**
Ada perubahan yang dianggap berisiko kehilangan data. Jalankan `bash scripts/pre-migrate.sh` lebih dulu.

**Tidak ada meja yang muncul di denah lantai**
Data awal belum diisi. Jalankan `npm run db:seed`.

**Tidak bisa masuk `/admin`**
Belum ada akun admin. Jalankan `npx tsx scripts/create-admin.ts`.

**Pembayaran tidak pernah berubah jadi lunas**
Periksa `PAYMENT_GATEWAY` dan `NEXT_PUBLIC_DEMO_MODE`. Untuk Duitku, pastikan URL callback sudah didaftarkan di dashboard Duitku.

**Perubahan realtime tidak sampai ke browser**
Periksa koneksi database masih hidup dan endpoint SSE di `/api/realtime/` dapat diakses. Reverse proxy perlu mengizinkan koneksi terbuka lama dan mematikan buffering.

---

Dibuat untuk SOHO Social House Purwokerto.
