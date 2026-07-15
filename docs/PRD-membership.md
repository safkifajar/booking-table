# PRD — Membership Berjenjang (Basic / Premium / VIP)

**Status:** FINAL revisi 3 — konsep voucher DIROMBAK (2026-07-15 sore, arahan user) + tax & service + picker
**Tanggal:** 2026-07-15
**Bergantung pada:** Fitur Friends & Block (sudah rilis), infrastruktur pembayaran QRIS (gateway generik + pola polling `payShare`)

---

## 1. Ringkasan

Sistem membership berbayar tiga tingkat. Semua user baru otomatis **basic** (gratis). Level yang lebih tinggi membuka **jangkauan sosial** yang lebih luas: siapa yang terlihat di Network, story siapa yang tampil, dan siapa yang bisa diundang ke meja. Admin mengelola nama level, harga, periode tagihan, voucher diskon, dan bisa mengubah level customer secara manual. Pembayaran memakai QRIS lewat gateway yang sudah ada.

**Prinsip pemandu #1 — membership TIDAK menyentuh bisnis inti bar.** Buka meja, reservasi, pesan menu, bayar tagihan, rating sesama penghuni meja: semuanya tetap terbuka untuk semua level. Yang dibatasi hanya lapisan **sosial digital** (Network, story, undangan). Alasannya: revenue F&B tidak boleh terhalang paywall, dan orang yang duduk semeja secara fisik tidak bisa "disembunyikan" oleh software.

**Prinsip pemandu #2 — satu sumber kebenaran level.** Semua pengecekan level lewat helper terpusat (`src/lib/membership.ts`), meniru pola `src/lib/friends.ts` yang terbukti: tak ada query level tersebar, tak ada aturan visibilitas yang diduplikasi.

---

## 2. Keputusan Produk (dari requirement)

| # | Keputusan |
|---|-----------|
| **M1** | User baru otomatis **basic** saat daftar. Basic gratis, tidak bisa "dibeli". |
| **M2** | Tiga level tetap: rank 1 **basic** → rank 2 **premium** → rank 3 **vip**. **Nama tampilan bisa diganti admin**; kunci internal (`basic/premium/vip`) dan jumlah level TIDAK bisa diubah di v1 (aturan visibilitas hard-coded ke rank). |
| **M3** | Admin mengatur **harga** dan **periode tagihan** per level: sekali bayar (seumur hidup) / bulanan / tahunan. |
| **M4** | **Visibilitas Network berbasis rank: kamu melihat level-mu dan di bawahnya.** Basic → hanya basic. Premium → basic + premium. VIP → semua. |
| **M5** | Kartu Network user yang level-nya lebih tinggi **tetap muncul tapi TERKUNCI** (pola komponen private yang sudah ada) — bukan hilang dari daftar. Badge **"At SOHO" tetap terlihat** di kartu terkunci. |
| **M6** | Undangan meja: kandidat = **(level ≤ level pengundang) ∪ teman**. Meja tipe *friends* tetap **hanya teman** (aturan Friends tak berubah). Berlaku untuk SEMUA level, bukan hanya basic — basic mengundang sesama basic + teman; premium mengundang basic/premium + teman; VIP siapa saja. |
| **M7** | **REVISI rev-3:** Voucher = **BENEFIT member**, BUKAN kode promo beli membership. Admin membuat **TEMPLATE** (nama + aturan potongan **transaksi bill** + level + masa berlaku hari); saat membership AKTIF (beli/perpanjang/admin grant) tiap member menerima **instance pribadi berkode UNIK** (kode tiap orang beda, `SOHO-XXXX-XXXX`). Redeem: potongan pembayaran bill meja — sekali pakai — di alur bayar customer (QRIS) & kasir. Aturan instance = SNAPSHOT template. Pemilik voucher harus member JOINED meja tsb. Diskon dicatat sbg baris `payments` method `voucher` supaya outstanding tertutup benar; reserve saat QR pending (race-safe), release saat gagal/batal, settle idempotent saat paid. Tak ada lagi input voucher di checkout membership. |
| **M8** | Admin bisa **mengubah level customer manual** dari detail customer (grant/revoke, tercatat di riwayat transaksi). |
| **M9** | Admin punya **daftar pembayaran membership** (menu sendiri, terpisah dari payments order F&B). |
| **M10** | Customer punya halaman **beli / perpanjang / riwayat transaksi** membership. |
| **M11** | **Banner membership** di halaman utama customer → klik menampilkan pilihan paket. |
| **M12** | **Status membership terlihat** di tiap customer: badge level di admin (list + detail) dan di app (profil sendiri). |
| **M13** | Pembayaran **QRIS** memakai gateway existing (`getPaymentGateway()` — mock sekarang, Xendit/Duitku nanti tanpa mengubah fitur ini). |
| **M14** | **(rev-3)** Pembayaran membership dikenakan **tax & service** dari `ChargeConfig` bar — konfigurasi yang SAMA dgn bill F&B (`computeBillTotals`, satu sumber kebenaran). Snapshot `tax_amount`/`service_amount` di transaksi; total = base + tax + service. |
| **M15** | **(rev-3)** Picker undangan meja menampilkan **@username + badge level membership** tiap kandidat (badge warna per key; nama level dari admin). |

---

## 3. Keputusan GAP — FINAL (semua usulan default DISETUJUI user, 2026-07-15)

| # | Pertanyaan | Keputusan | Alasan |
|---|-----------|----------------|--------|
| **G1** | **Model harga per level**: satu kombinasi periode+harga per level (premium = bulanan 100rb TITIK), atau beberapa opsi per level (premium bulanan 100rb ATAU tahunan 1jt)? | **Satu kombinasi per level.** | Jauh lebih sederhana (admin, UI beli, logika perpanjang). Multi-opsi bisa ditambah belakangan tanpa migrasi sulit. |
| **G2** | **Pertemanan menembus kunci level?** Basic yang berteman dengan VIP — saling terlihat penuh? | **Ya, teman selalu saling melihat** (kartu, profil, story, undangan). | Konsisten dengan keputusan Friends K5 (teman menembus akun privat). Tanpa ini muncul keadaan aneh: berteman tapi profilnya terkunci. Catatan: request pertemanan BARU hanya bisa dikirim ke orang yang terlihat (kartu terkunci tak punya tombol Add friend) — jadi lintas-level hanya bisa diinisiasi dari atas ke bawah (VIP meng-add basic), lalu keduanya saling terbuka. |
| **G3** | **Story untuk basic**: terkunci total (tidak lihat story sama sekali), atau story mengikuti aturan level (basic lihat story sesama basic)? | **Mengikuti aturan level** — story dari user dengan rank ≤ rank-mu (+ teman, per G2). | Konsisten dengan Network (requirement "basic tidak dapat melihat story" tertulis, tapi requirement network yang serupa ternyata dimaksudkan "terkunci sebagian" — pola yang sama diterapkan). Efek samping menarik: story VIP jadi eksklusif sesama VIP. Kalau maunya basic benar-benar 0 story, bilang — implementasinya malah lebih mudah. |
| **G4** | **User existing saat rilis** — semua langsung basic (kehilangan akses Network/story yang kemarin masih bebas)? | **Ya, semua basic**, TAPI rilis dibarengi **voucher promo** (mis. diskon besar bulan pertama) yang di-broadcast, supaya downgrade terasa sebagai ajakan upgrade, bukan hukuman. | Grandfather premium gratis menunda masalah dan mengacaukan data pembayaran. Voucher launch = jalan keluar yang sekaligus menguji funnel beli. |
| **G5** | **Upgrade di tengah masa aktif** (premium bulanan masih 20 hari, beli VIP): sisa masa hangus, atau prorata? | **Ganti langsung, masa aktif baru dihitung dari sekarang, sisa hangus** — dengan peringatan jelas di UI sebelum bayar. | Prorata = kompleksitas besar (hitung kredit, refund parsial) untuk kasus yang jarang. Bisa ditambah nanti. |
| **G6** | **Perpanjang level yang sama** sebelum habis: masa baru ditambahkan dari tanggal habis (stack), kan? | **Ya — expiry = max(now, expiry lama) + periode.** | Standar industri; perpanjang H-3 tidak merugikan 3 hari. |
| **G7** | **Meja & preview**: nama host/member meja tetap terlihat di feed meja + halaman preview walau level-nya lebih tinggi dari viewer? | **Ya, konteks meja fisik tidak dikunci** — hanya PROFIL-nya yang terkunci saat diklik. | Sejalan prinsip #1 dan requirement "badge At SOHO tetap terlihat". Menyembunyikan orang yang duduk 3 meter dari kamu itu absurd + merusak fitur bar. |
| **G8** | **Request join meja** dibatasi level? (Basic request-join ke meja public milik VIP?) | **Tidak dibatasi** — meja public tetap "anyone can join" (approval host tetap berlaku); meja friends tetap teman-only. | Yang dibatasi requirement hanya arah UNDANGAN (host memilih orang). Join fisik ke meja = bisnis bar. |

---

## 4. Model Data

### 4.1 `membership_levels` — 3 baris seed, dikelola admin

| Kolom | Tipe | Catatan |
|---|---|---|
| `key` | text **PK** | `basic` / `premium` / `vip` — **immutable**, dipakai kode |
| `rank` | int, UNIQUE | 1 / 2 / 3 — dasar semua perbandingan visibilitas |
| `name` | text | Nama tampilan, **editable admin** (mis. "Silver", "Gold") |
| `price` | int (IDR) | basic dipaksa 0 |
| `billing_period` | enum `one_time` / `monthly` / `yearly` | per G1: satu kombinasi per level |
| `description` | text | Copy benefit untuk halaman beli |
| `is_purchasable` | boolean | basic = false, terkunci |
| `updated_at` | timestamptz | |

### 4.2 Kolom baru di `profiles`

| Kolom | Tipe | Catatan |
|---|---|---|
| `membership_level` | text NOT NULL default `'basic'`, FK → `membership_levels.key` | Level tersimpan |
| `membership_expires_at` | timestamptz NULL | NULL = tanpa batas (basic / lifetime) |

**Level EFEKTIF ≠ level tersimpan.** `getEffectiveLevel()`: kalau `membership_expires_at < now` → efektif **basic** (lazy downgrade, tanpa cron — pola `promoteSessionIfDue`/`expireOverdueDpBookings` yang sudah ada). Kolom di DB tak perlu di-reset; opsional job pembersih belakangan.

### 4.3 `membership_transactions`

| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | uuid PK | |
| `profile_id` | FK profiles, cascade | |
| `level_key` | text FK | Level yang dibeli |
| `kind` | enum `purchase` / `renewal` / `admin_grant` | admin_grant amount 0 |
| `base_amount` / `amount` | int | Harga sebelum & sesudah voucher — **snapshot**, audit-proof kalau admin ganti harga |
| `voucher_id` | FK NULL | |
| `period_start` / `period_end` | timestamptz / NULL | period_end NULL = lifetime |
| `status` | reuse `payment_status` enum (`pending`/`paid`/`failed`/`refunded`) | |
| `method` | `'qris'` | |
| `gateway_ref`, `qr_string`, `qr_expires_at`, `merchant_order_id` | | Pola sama dgn `payments` |
| `granted_by` | uuid NULL | Admin, untuk `admin_grant` |
| `paid_at`, `created_at` | | |

Sengaja **tabel sendiri**, bukan menumpang `payments` (yang FK ke orders NOT NULL). Gateway-nya tetap sama.

### 4.4 `membership_vouchers`

| Kolom | Tipe | Catatan |
|---|---|---|
| `id` uuid PK, `code` text UNIQUE (disimpan uppercase) | | |
| `discount_type` | enum `percent` / `fixed` | |
| `discount_value` | int | percent 1–100 / rupiah |
| `level_key` | text FK NULL | NULL = berlaku semua level purchasable |
| `max_uses` | int NULL | NULL = tak terbatas; `used_count` counter |
| `per_user_limit` | int default 1 | |
| `valid_from` / `valid_until` | timestamptz NULL | |
| `is_active` | boolean | |

Diskon 100% / harga final 0 → transaksi langsung `paid` tanpa memanggil gateway (aktivasi instan).

---

## 5. Aturan Visibilitas (matriks)

`canSee(viewer, target) = effRank(viewer) >= effRank(target) || areFriends(viewer, target)` *(bagian teman per G2)*

| Permukaan | Perilaku terhadap target yang TIDAK terlihat |
|---|---|
| Network list (`listAllMembers`) | Kartu tetap tampil **TERKUNCI**: avatar + nama terlihat, detail (umur/area/hobi/rating) blur ala komponen private, **badge At SOHO tetap tampil**, tombol Add friend & link detail nonaktif → CTA "Upgrade untuk terhubung" |
| Profil `/network/[userId]` | Stub terkunci (pola `locked` private yang sudah ada di `getPublicProfile`) + CTA upgrade |
| Halaman teman user lain | Baris milik level lebih tinggi ikut terkunci (nama terlihat, tak bisa diklik) |
| Story bar + viewer | Story dari level lebih tinggi **tidak dimuat sama sekali** (bukan blur — konten tak boleh terkirim ke client) |
| Kandidat undangan meja (`searchInviteCandidates`) | Tidak muncul di hasil; guard server di `openTable`/`inviteUsersToSession` membuang senyap (pola guard blokir yang sudah ada) |
| Feed meja, preview meja, anggota semeja, rating semeja, "Lagi di SOHO" | **TIDAK dikunci** (G7/G8, prinsip #1) |
| Blokir & privasi | Aturan blokir/private **selalu menang** — dicek lebih dulu, level tak bisa membuka yang diblokir |

Semua penyaringan batch (satu query set rank per daftar, bukan per-baris — pelajaran `getFriendCounts`).

---

## 6. Alur Pembelian (customer)

1. `/membership`: kartu 3 level (nama, harga, periode, benefit) + status level saat ini & masa aktif. Tab kedua: **riwayat transaksi**.
2. Pilih level → input voucher (opsional, tervalidasi server: aktif, kuota, jendela waktu, level cocok, limit per user) → ringkasan harga → **bayar QRIS** (dialog QR + polling status, persis pola DP booking / `payShare`).
3. `paid` (polling/callback, idempotent — conditional update `WHERE status='pending'`):
   - Level sama & masih aktif → **perpanjang** (G6).
   - Level beda → **ganti sekarang**, periode dari now (G5).
   - `used_count` voucher naik; notif in-app "Membership aktif".
4. Satu transaksi `pending` per user pada satu waktu (yang lama dibatalkan otomatis saat buat baru).
5. Banner di home (M11): tampil untuk basic ("Upgrade untuk melihat lebih banyak member") dan untuk member berbayar yang **H-7 kedaluwarsa** ("Perpanjang sekarang") → link `/membership`. Notif pengingat H-3.

## 7. Permukaan Admin

Seksi sidebar baru **"Membership"**:

| Halaman | Isi |
|---|---|
| `/admin/membership` | Kelola 3 level: nama, harga, periode, deskripsi (basic: nama & deskripsi saja) |
| `/admin/membership/vouchers` | CRUD voucher + kuota + status pemakaian |
| `/admin/membership/transactions` | Semua transaksi membership (filter status/level/tanggal), terpisah dari payments F&B |

Di customer (M8, M12): badge level di **list** (sebelah badge Active) + di **detail** — kontrol "Change membership": pilih level + durasi (preset periode level / custom / lifetime) → tercatat sebagai `admin_grant`.

## 7b. Keputusan kecil tambahan (hasil audit gap, default wajar — veto bila tak setuju)

| # | Hal | Default |
|---|---|---|
| **G9** | Voucher untuk perpanjangan? | **Ya** — voucher berlaku untuk pembelian BARU maupun perpanjangan (satu jalur checkout yang sama). |
| **G10** | Posting story dibatasi level? | **Tidak** — semua level boleh POSTING; yang difilter level hanya siapa MELIHAT (G3). Story basic terlihat semua orang; story VIP hanya sesama VIP + teman. |
| **G11** | Request pertemanan MASUK dari level lebih tinggi (VIP add basic): penerima bisa lihat apa? | Baris request menampilkan nama + avatar dan tombol Terima/Tolak **berfungsi normal**; link profilnya tetap terkunci sampai diterima (setelah teman → terbuka penuh per G2). |
| **G12** | Auto-renewal? | **Tidak ada** — QRIS tak bisa auto-tagih. Perpanjang selalu manual; pengingat H-7 banner + H-3 notif (fase 5) adalah pengganti auto-renew. |
| **G13** | Kanal pengumuman voucher promo rilis (G4)? | Pakai **banner promo admin yang sudah ada** (/admin/banners) + banner membership bawaan fitur ini. Tidak membangun sistem broadcast baru. |
| **G14** | Undangan meja pending saat pengundang turun level sebelum diterima? | Tetap sah — undangan adalah konsen dua sisi yang sudah diberikan; penerima tetap bisa Terima/Tolak. |

## 8. Edge case & anti-abuse

**Pembayaran & transaksi**
- **Voucher race** (2 orang memakai kuota terakhir bersamaan): increment `used_count` dengan conditional update `WHERE used_count < max_uses` saat aktivasi — kalah race → transaksi gagal divalidasi ulang sebelum QR dibuat.
- **Aktivasi idempotent**: polling dan callback bisa datang bersamaan → aktivasi lewat conditional update `WHERE status='pending'`; hanya satu yang menang (pola `payShare`).
- **SEMUA parameter di-snapshot saat QR dibuat** — bukan hanya harga: level, periode (`period_start`/`period_end` final), dan diskon voucher dikunci di baris transaksi. Admin mengubah harga/periode/menonaktifkan voucher/level di tengah QR pending → pembayaran tetap diaktivasi sesuai snapshot.
- **QR dibayar setelah `qr_expires_at`** (gateway race): kalau gateway melapor paid, tetap diaktivasi — uang sudah berpindah; expiry QR hanya UI hint.
- **Diskon melebihi harga**: di-clamp — harga final minimum 0; final 0 → aktivasi instan tanpa gateway.
- **Kedaluwarsa saat sesi meja berjalan**: efek hanya pada Network/story/undangan berikutnya; keanggotaan meja berjalan tidak disentuh.
- **Downgrade manual oleh admin saat ada transaksi pending**: pending tetap bisa dibayar, berlaku aturan aktivasi normal. **Admin grant saat membership berbayar masih aktif**: menimpa (aturan G5 — sisa hangus), UI admin menampilkan peringatan sisa masa.
- **Refund**: di luar scope v1 (status `refunded` disiapkan di enum untuk manual ops).

**Visibilitas & level efektif**
- **Perbandingan level SELALU memakai level EFEKTIF kedua sisi** (viewer maupun target). Premium yang kedaluwarsa = basic seketika: tak terlihat oleh basic? — justru TERLIHAT oleh basic (efektif basic), dan kehilangan akses premium-nya sendiri. Tanpa cron, konsisten di semua permukaan.
- **Story milik user yang turun level** menjadi terlihat lebih luas seketika (filter memakai rank penulis SAAT DILIHAT, bukan saat posting) — konsekuensi lazy-downgrade, diterima.
- **Daftar penonton story**: penonton berlevel lebih tinggi tetap tampil (nama + avatar) di daftar penonton story-mu; link profilnya terkunci (perlakuan sama dgn G11).
- **Pencarian Network**: kartu terkunci tetap ditemukan lewat pencarian nama (nama memang terlihat di kartu terkunci — M5).
- **Halaman yang telanjur di-render sebelum kedaluwarsa**: konten lama bisa tampil sampai navigasi/refresh berikutnya — pengecekan lazy per-request, tidak real-time; diterima (sama dengan perilaku unfriend).
- **Admin bypass total**: semua permukaan admin membaca data tanpa kunci level (pola `admin: true` di `getPublicProfile`).
- **Guest & staff**: di luar sistem membership (sudah tak muncul di Network).

**Konsistensi data**
- Harga & nama di UI beli selalu dibaca live dari `membership_levels`; yang ditagih & diaktivasi = snapshot transaksi.
- FK `profiles.membership_level` → `membership_levels.key` menjamin tak ada level yatim; seed 0059 memastikan 3 baris level ada SEBELUM kolom profiles ditambahkan (pre-migrate).

## 9. Rencana Implementasi (bertahap, tiap fase bisa dirilis)

| Fase | Isi | Catatan |
|---|---|---|
| **1. Fondasi** | Schema (3 tabel + 2 kolom profiles + enum) + seed 3 level + `src/lib/membership.ts` (getEffectiveLevel, canSee, batch rank helpers) + badge level di profil sendiri | Migrasi non-destruktif; belum ada yang terkunci |
| **2. Admin** | Kelola level, voucher CRUD, list transaksi, ubah level per customer, badge di list/detail | Admin siap SEBELUM customer bisa beli |
| **3. Beli** | `/membership` (paket + voucher + QRIS + riwayat), banner home, notif aktivasi | Funnel beli hidup, konten belum dikunci |
| **4. Enforcement** | Kunci Network (kartu + profil + halaman teman), story, kandidat & guard undangan | **Dirilis TERAKHIR + bersamaan voucher promo (G4)** — user punya jalur upgrade sebelum ada yang dikunci |
| **5. Polish** | Pengingat H-3/H-7, CSV transaksi, statistik member per level di overview admin | |

## 10. Kriteria Penerimaan (inti)

1. Daftar baru → basic; tak bisa beli basic.
2. Basic tak melihat kartu/story/profil premium & VIP (terkunci), premium tak melihat VIP, VIP melihat semua; badge At SOHO tetap tampil di kartu terkunci.
3. Teman lintas level saling terbuka penuh (kalau G2 = ya); blokir selalu menang.
4. Undangan meja hanya menawarkan (level ≤ pengundang) ∪ teman; guard server menahan pemaksaan devtools; meja friends tetap teman-only.
5. Beli premium via QRIS + voucher → terpotong benar, aktif setelah paid, muncul di riwayat customer & list admin; perpanjang menambah dari expiry lama; kedaluwarsa → efektif basic tanpa cron.
6. Admin ganti nama level → nama baru muncul di seluruh app; admin ubah level customer → tercatat sebagai admin_grant.
7. Buka meja, order, bayar, rating: tidak terpengaruh level sama sekali.
