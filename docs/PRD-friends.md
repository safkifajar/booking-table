# PRD — Friends & Block (Pertemanan Antar User)

**Status:** Draft final untuk persetujuan (revisi 3 — setelah audit adversarial)
**Tanggal:** 2026-07-14
**Konteks:** SOHO Social House — app booking meja + social discovery

> **Catatan:** dokumen ini bahasa Indonesia. **Kode & seluruh teks UI ditulis dalam bahasa Inggris**, mengikuti app yang sudah seragam Inggris (tombol, notifikasi, pesan error).

---

## 1. Latar Belakang & Tujuan

App ini sudah punya **discovery** (Network: cari orang, lihat profil, rating, hobi) dan **meja bersama**. Tapi tak ada **relasi antar user** — semua orang setara "orang asing".

**Tujuan:**
- Mengundang ke meja jadi relevan (undang yang memang kenal)
- Discovery punya "hasil" — kenalan di meja berlanjut jadi teman
- Story terasa personal (teman di depan)
- User punya kendali atas siapa yang boleh menghubunginya (**blokir**)

### Temuan audit kode (penting)

> **Belum ada konsep pertemanan apa pun.** Tak ada tabel, kolom, atau query.

> ⚠️ **`visibility: "friends"` sekarang adalah LABEL KOSONG.** Ia tak memfilter siapa pun. Yang ia lakukan cuma: orang yang dipilih host **langsung di-join**. Dan host bisa memilih **siapa pun** — tanpa consent target.

> 🔴 **`createInvite` tak punya guard host** — siapa pun yang login bisa membuat kode undangan untuk **session mana pun** lewat devtools, lalu masuk lewat kode itu. **Ini lubang yang sudah menganga hari ini**, bukan efek fitur baru.

> 🔴 **Setiap meja otomatis dibuatkan kode undangan** saat dibuka, padahal **kode itu tak pernah ditampilkan ke siapa pun** — fitur invite-link sudah mati di UI (tak ada tombol share/copy, tak ada link ke `/join/` dari mana pun).

---

## 2. Keputusan Produk

| # | Keputusan |
|---|-----------|
| **K1** | **Pertemanan dua arah + approval.** A kirim request → B terima → berteman. |
| **K2** | **Undang meja tipe "friends" hanya menampilkan teman.** |
| **K3** | **Meja "friends":** semua orang tetap bisa **MELIHAT**; hanya teman host yang bisa **GABUNG**. |
| **K4** | **Story: teman diprioritaskan di URUTAN saja.** Semua story tetap terlihat semua orang. |
| **K5** | **Akun privat terbuka untuk teman.** Orang asing tetap tertutup. |
| **K6** | **Blokir: penuh & simetris & tersamar.** Menutup **semua** jalur interaksi (§7). |
| **K7** | **Hapus fitur invite-link** (halaman `/join/[code]`, action `joinByCode`, tabel `session_invites`). Sudah mati di UI, dan merupakan **bypass total** untuk K3. |
| **K8** | **Anti-spam:** cooldown **1 hari** setelah ditolak + kuota 20 request keluar / 24 jam. |

---

## 3. Ruang Lingkup

### Termasuk

**Friends (a–k)** — sesuai requirement awal:
a. saling berteman · b. menu daftar teman · c. undang meja hanya teman · d. story utamakan teman · e. unfriend + approval · f. lihat teman user lain · g. jumlah teman · h. notif request & approval (in-app + push) · i. admin (jumlah + daftar) · j. badge request di Network · k. tombol Add friend di kartu Network

**Block (K6)** — blokir/buka blokir dari menu ⋮ profil · halaman `/profile/blocked` · efek menyeluruh (§7)

**Pembersihan (K7)** — hapus invite-link

### TIDAK termasuk
- Mutual friends / saran teman / chat
- Laporan (report) user
- Batas jumlah teman (tanpa batas)

---

## 4. Model Data

Tiga tabel baru di `src/lib/db/schema/friends.ts`.

### 4.1 `friend_requests`

| Kolom | Tipe |
|---|---|
| `id` | uuid PK |
| `requester_id` | uuid → profiles, **cascade** |
| `addressee_id` | uuid → profiles, **cascade** |
| `status` | enum `pending / accepted / rejected / cancelled` |
| `created_at`, `responded_at` | timestamptz |

- **Unique** `(requester_id, addressee_id)` — **satu baris per arah, dipakai ulang** (lihat §6.3)
- **CHECK** `requester_id <> addressee_id`
- Index kedua arah

### 4.2 `friendships` — satu baris per pasangan

| Kolom | Tipe |
|---|---|
| `user_a_id` | uuid → profiles, cascade (**selalu yang lebih kecil**) |
| `user_b_id` | uuid → profiles, cascade |
| `created_at` | timestamptz |

- **PK gabungan** `(user_a_id, user_b_id)`
- **CHECK** `user_a_id < user_b_id`

**Kenapa satu baris?** Menutup seluruh kelas bug "pertemanan sebelah" (satu arah terhapus, satu lagi tidak). Struktur ini membuat duplikat/terbalik **mustahil**.

> ⚠️ **Konsekuensi yang harus diantisipasi:** query jadi lebih repot (harus cek dua kolom). Ada godaan nyata untuk kembali ke model 2-baris demi kenyamanan. **Mitigasi:** sediakan **view `v_friend_counts`** + helper terpusat di Fase 1, sehingga tak ada yang perlu menulis query mentah.

### 4.3 `user_blocks`

| Kolom | Tipe |
|---|---|
| `blocker_id` | uuid → profiles, cascade |
| `blocked_id` | uuid → profiles, cascade |
| `created_at` | timestamptz |

- **PK gabungan** `(blocker_id, blocked_id)`
- **CHECK** `blocker_id <> blocked_id`
- Index di `blocked_id`

**Disimpan searah** (untuk halaman daftar blokiran), **efek simetris**.

> ⚠️ **A blokir B dan B blokir A = 2 baris berbeda.** Saat A membuka blokir, blokir B→A **tetap berlaku**. Semua pengecekan wajib: `EXISTS(A→B) OR EXISTS(B→A)`.

### 4.4 Enum notifikasi baru
`friend_request`, `friend_accepted`

> ⚠️ Butuh **3 tempat**: `_enums.ts` + `NotifType` + file SQL `-- pre-migrate`. Lupa yang SQL → error di production.

### 4.5 Kolom baru: `notifications.ref_id`

Notifikasi sekarang dicocokkan lewat **teks link** — rapuh. Untuk friend request, tambah `ref_id uuid` (nullable) yang menyimpan id request, agar bisa dicocokkan **by ID**.

---

## 5. Status Relasi

`none` · `pending_out` · `pending_in` · `friends` · `blocked` (aku memblokir dia)

> **`blocked_by` TIDAK ADA sebagai status yang terlihat.** Kalau dia memblokir aku, dari sisiku dia **tidak ada sama sekali** (§7).

---

## 6. Aturan — Friends

### 6.1 Alur

1. **Kirim request** — hanya kalau status `none`
   - Kalau **dia sudah kirim request ke aku** (`pending_in`) → **langsung jadi teman**
   - Kena cooldown/kuota (§6.4) → ditolak dengan pesan jelas
   - Ada blokir → **diam-diam gagal** (§7.3)
2. **Terima** → buat `friendships`, request `accepted`, notif ke pengirim
3. **Tolak** → request `rejected`. Pengirim **tidak** diberi tahu.
4. **Batalkan request sendiri** → `cancelled`
5. **Unfriend** → hapus `friendships`. Tanpa notifikasi. Bisa berteman lagi.

### 6.2 Notifikasi

| Kejadian | Penerima | Judul (Inggris) |
|---|---|---|
| Request masuk | Yang dituju | "{Name} sent you a friend request" |
| Request diterima | Pengirim | "{Name} accepted your friend request" |
| Ditolak / unfriend / blokir | — | *(tak ada)* |

Bell + web push otomatis. Notif request punya tombol **Accept / Decline** langsung.

### 6.3 ⚠️ Kirim ulang setelah ditolak — baris DIPAKAI ULANG

**Kontradiksi yang ditemukan audit:** unique `(requester, addressee)` membuat INSERT kedua **selalu gagal** — jadi "boleh kirim ulang" mustahil kalau pakai insert biasa.

**Solusi:** `ON CONFLICT (requester_id, addressee_id) DO UPDATE` — baris lama di-*reset* jadi `pending` lagi (dengan `created_at` baru, `responded_at` dikosongkan), **hanya kalau** statusnya bukan `pending` dan cooldown sudah lewat.

### 6.4 Anti-spam (K8)

| Aturan | Nilai |
|---|---|
| **Cooldown kirim-ulang** | **TIDAK ADA** (revisi 2026-07-14 — permudah berteman). Kirim ulang setelah ditolak/dibatalkan langsung boleh. Rem spam yang tersisa: kuota harian + tanpa push utk kiriman ulang <24 jam. |
| **Kuota harian** | Maks **20** request keluar / 24 jam |
| **Push berulang** | Request kedua ke orang yang sama dalam 24 jam → **tak ada push** |

> Tanpa ini, penyerang bisa kirim-tolak berulang → **ratusan push ke HP korban**. Unique constraint **tidak** mencegah ini (itu klaim keliru di revisi sebelumnya).

---

## 7. Aturan — Block (K6)

**Simetris & tersamar.** Kalau A memblokir B, dari sisi B **A tidak ada sama sekali**.

### 7.1 Efek

| Area | Efek |
|---|---|
| **Pertemanan** | Putus seketika. Request pending (kedua arah) dibatalkan. |
| **Network** | Saling hilang dari daftar. |
| **Profil** | Saling tak bisa dibuka (404). |
| **Story** | Saling tak muncul (**5 fungsi**, §7.2). |
| **"Lagi di SOHO"** | Saling tak muncul — ⚠️ ini membocorkan **lokasi fisik** (meja mana). |
| **Minta gabung / gabung meja** | Yang diblokir **tak bisa** masuk meja korban. |
| **Rating** | Yang diblokir **tak bisa** memberi rating ke korban. |
| **Undangan meja** | Tak bisa saling mengundang. |

### 7.2 ⚠️ Daftar LENGKAP jalur yang wajib disaring

Audit menemukan **13+ jalur**, bukan 5. Yang terlewat di revisi sebelumnya ditandai **BARU**.

**Fungsi yang menampilkan orang (saring daftar):**

| Fungsi | Catatan |
|---|---|
| `listAllMembers` | Network |
| `getPublicProfile` | Profil → 404 kalau blokir |
| **`getActiveUsersAtBar`** 🔴 **BARU** | "Lagi di SOHO" — **membocorkan meja mana korban duduk**. Paling berbahaya (keamanan fisik, bukan sekadar privasi). |
| **`getActiveProfileIdsAtBar`** **BARU** | Badge "At SOHO now" |
| `getActiveStoriesByBar` | Story bar |
| `getStoriesForUser` | Story per-user — **bisa dipanggil langsung dari client** |
| **`getLatestStoriesByBar`** 🔴 **BARU** | Feed landing — **tak punya parameter viewer sama sekali** (komentarnya: *"Public — no auth check"*). Persis jenis fungsi yang terlupakan. |
| **`hasActiveStory`** **BARU** | Ring story di avatar |
| **`getStoryViewers`** **BARU** | Daftar penonton story |
| `searchInviteCandidates` | Kandidat undangan |
| **`getReviewsForUser`** **BARU** | Menampilkan **nama + foto** pemberi rating |

**Aksi yang wajib ditolak (guard mutasi):**
`joinSession` · `requestJoinSession` · `acceptInvite` · `inviteUsersToSession` · `openTable` (pilih undangan) · **`submitRating`**

> 🔴 **Tanpa guard mutasi, blokir GAGAL sebagai perlindungan.** Yang diblokir masih bisa **memaksa notifikasi + push muncul di HP korban** berulang kali lewat "minta gabung meja korban" atau "beri rating". Ini yang sering terlewat.

### 7.3 Blokir tersamar — bagaimana caranya

Karena A hilang total dari sisi B (Network, profil, story), **B tak punya tombol untuk menekan apa pun**. Jadi skenario "B kirim request lalu dapat error" praktis tak ada lewat UI.

Yang tersisa: B memaksa lewat **devtools**.
→ Server **diam-diam menolak**: tak menyimpan apa pun, tak beri tahu siapa pun, tak melempar error yang membocorkan ("You are blocked" ❌).

> Kalau server menjawab error terang-terangan, B langsung menyimpulkan dia diblokir (karena ke orang lain berhasil). **Silent-fail adalah syarat mutlak.**

**Notifikasi saat blokir:** ubah/hapus notif **milik yang memblokir saja**. **Jangan kirim apa pun ke yang diblokir** — sekali push "request dibatalkan" terkirim, blokirnya bocor.

### 7.4 Pengecualian yang disengaja

| Kasus | Keputusan | Alasan |
|---|---|---|
| **Sudah satu meja lalu saling blokir** | Tetap saling terlihat **di meja itu** | Tak mungkin menyembunyikan orang yang duduk bersama — tagihan & daftar anggota harus konsisten. Blokir mencegah **interaksi baru**. |
| **Meja di feed/denah** | Meja **tetap tampil** (termasuk nama host) | Kalau disembunyikan, denah jadi bolong & meja terisi tampak kosong → **merusak fitur inti booking**. Yang ditolak: **aksi gabung**. |
| **Preview meja** | Tetap tampil | Ruang publik. |
| **Admin** | **Bypass semua filter** | Admin harus bisa melihat segalanya. |
| **Staff tambah tamu walk-in** | **Dikecualikan dari guard** | Tamu (`is_guest`) bukan teman siapa pun; kalau tidak dikecualikan, staff tak bisa menambah tamu ke meja "friends". |

---

## 8. Akun Privat + Teman (K5)

Teman bisa melihat profil privat penuh; orang asing tetap tertutup.

**Yang di-bypass teman:** `is_private` (bio, hobi, prompts, riwayat, dst)

**Yang TIDAK di-bypass teman:** ⚠️ **`hide_location`** — itu setting **keamanan fisik**, bukan privasi sosial. Kalau seseorang menyembunyikan lokasinya, teman pun tak boleh melihat dia "Lagi di SOHO".

**Catatan teknis:**
- Sekarang ada **dua sumber kebenaran** untuk "boleh lihat penuh atau tidak" (di query dan di halaman). **Konsolidasikan** jadi satu field eksplisit dari server.
- Jangan **fetch** data privat lalu sembunyikan di render — data tetap terkirim ke browser. **Jangan diambil sama sekali** kalau tak boleh dilihat.
- Setelah **unfriend**, halaman profil harus di-*refresh* (cache Next.js bisa menyajikan data lama).

---

## 9. Meja "friends" (K3) & Penghapusan Invite-Link (K7)

### 9.1 ⚠️ Guard harus di lapisan TERBAWAH

Ada **banyak jalur masuk** ke meja. Guard "harus teman host" **wajib** dipasang di **`joinSession`** (fungsi paling bawah yang dilewati semua jalur), **bukan** di `requestJoinSession` saja.

| Jalur | Aturan |
|---|---|
| `joinSession` | **Guard utama** — harus teman host (kalau meja "friends") |
| `requestJoinSession` | Guard sama |
| `acceptInvite` | Guard sama |
| **`joinByCode`** | ❌ **DIHAPUS** (K7) |
| `approveJoinRequest` | **Boleh siapa pun** — host memutuskan sendiri (kendali penuh atas mejanya) |
| `inviteUsersToSession` | Guard **K2** (hanya teman) |
| `openTable` (pilih undangan) | Guard **K2** (hanya teman) |
| `staffAddGuestToTable` | **Dikecualikan** (tamu walk-in) |

**Untuk bukan-teman:** meja tetap terlihat, detail bisa dibuka, tapi tombol gabung **nonaktif** dengan keterangan (*"Only the host's friends can join this table"*) — bukan error saat ditekan. Server tetap menolak kalau dipaksa.

### 9.2 K7 — Hapus invite-link

**Kenapa:** (1) **sudah mati** — kode tak pernah ditampilkan/dibagikan ke siapa pun; (2) merupakan **bypass total** K3; (3) `createInvite` **tak punya guard host** (lubang yang sudah ada).

**Yang dihapus:**
- Halaman `/join/[code]` (page + form)
- Action `joinByCode`, `createInvite`
- Pembuatan kode otomatis saat meja dibuka
- Prop `inviteCode` (sudah mati)
- **Tabel `session_invites`** (migrasi drop)

### 9.3 Kasus lain

| Kasus | Keputusan |
|---|---|
| Host **unfriend/blokir** anggota yang sudah joined | **Tetap di meja.** Mengeluarkan paksa akan merusak akuntansi tagihan (ada guard "tak boleh keluar kalau belum lunas"). |
| Host ubah visibility `public` → `friends` di tengah jalan | Anggota lama **tetap**. Request pending tetap bisa di-approve host (kendali penuh). |
| **QR meja** | Tunduk aturan sama — bukan teman tak bisa gabung meja "friends". |

---

## 10. Validasi & Edge Case

### 10.1 Guard wajib di SETIAP action

Satu helper `assertFriendableTarget(targetId)` dipanggil di semua action:

| Cek | Alasan |
|---|---|
| Sudah login | — |
| **Bukan diri sendiri** | Ada CHECK di DB, tapi errornya mentah. Guard app-level supaya pesannya jelas. |
| Target **ada** | — |
| Target **bukan guest** (`is_guest`) | 🔴 Tamu walk-in **tak bisa login** → request menggantung selamanya. Dan tiap tamu walk-in bikin profil baru → **ratusan target hantu**. |
| Target **bukan staff** | 🔴 Kalau bisa, staff jadi kandidat undangan meja "friends" → **membypass** exclusion staff yang sudah dijaga ketat. |
| Target **aktif** (`is_active`) | User yang dinonaktifkan admin. |
| **Tak ada blokir** (kedua arah) | Silent-fail (§7.3). |

> **Catatan (bug existing, di luar cakupan):** `getCurrentProfile` **tak mengecek `is_active`** — user yang dinonaktifkan admin masih bisa memanggil server action sampai sesinya kadaluarsa. Fitur ini akan mewarisi lubang tersebut. **Layak diperbaiki terpisah.**

### 10.2 Race condition

| Kasus | Penanganan |
|---|---|
| **A & B kirim request bersamaan** | Unique constraint **tidak** menolong — `(A,B)` dan `(B,A)` dua baris berbeda. → **Advisory lock per-pasangan** (satu lock, urutan deterministik → tak deadlock). Di dalam lock: baca ulang state, baru putuskan. |
| **Friendship terbentuk** | **Wajib** menutup **semua** request antar pasangan itu (kedua arah) dalam transaksi yang sama. Kalau tidak, request lawan-arah nyangkut & bisa di-accept lagi. |
| **A accept sementara B cancel** | Semua transisi status pakai **conditional update** (`WHERE status='pending'`) + cek jumlah baris terpengaruh. Nol baris → batalkan, pesan *"Request is no longer available"*. |
| **A blokir sementara B kirim request** | Tercakup advisory lock. Sabuk pengaman tambahan: **trigger DB** yang menolak insert request kalau ada blokir. |
| **Double-click / dua tab** | Unique constraint + `ON CONFLICT` → idempotent. |
| **Notifikasi terkirim tapi transaksi batal** | Kirim notif **setelah** commit, bukan di dalam transaksi. |

### 10.3 Aksi idempoten (tak boleh error)

| Aksi | Perilaku |
|---|---|
| Unfriend orang yang bukan teman | No-op, sukses |
| Blokir orang yang sudah diblokir | No-op — **tapi tetap jalankan efek sampingnya** (kalau-kalau blokir sebelumnya gagal separuh) |
| Buka blokir yang tak diblokir | No-op, sukses |
| Cancel/accept request yang bukan `pending` | Ditolak halus: *"Request is no longer available"* |

### 10.4 Integritas

| Hal | Aturan |
|---|---|
| **Urutan `user_a < user_b`** | ⚠️ **Jangan pernah** membangun query pertemanan di luar helper. Semua baca lewat `areFriends()` / `getFriendIds()`. Query yang lupa mengurutkan akan mengembalikan "bukan teman" padahal berteman → tombol Add friend muncul lagi → error unique constraint. |
| **Jumlah teman** | Butuh `UNION ALL` dua kolom → sediakan **view `v_friend_counts`**. Kalau tidak, orang akan tergoda kembali ke model 2-baris. |
| **Hapus customer** | FK cascade sudah menangani. (`deleteCustomer` juga menolak user yang punya riwayat meja.) |
| **Beban query Network** | Status relasi diambil **satu query** untuk seluruh halaman (`WHERE other_id = ANY(...)`), **bukan** per kartu. |

### 10.5 Notifikasi basi

| Kasus | Penanganan |
|---|---|
| Request dibatalkan/ditolak | Notif lama **diubah** (tombol Accept hilang) — cocokkan **by `ref_id`**, bukan teks link |
| **Blokir** | Ubah notif **milik yang memblokir saja**. ❌ **Jangan** kirim apa pun ke yang diblokir. |
| Badge "request masuk" | Hitung `pending` **+ kecualikan** pengirim yang diblokir/nonaktif/dihapus |

---

## 11. Halaman & Komponen

| Rute | Isi |
|---|---|
| `/profile/friends` | Daftar teman + tab Requests (masuk/keluar) + unfriend |
| `/profile/blocked` | Daftar blokiran + buka blokir |
| `/network/[userId]/friends` | Daftar teman user lain |

Perubahan: **Profil publik** (jumlah teman + tombol Add/Requested/Friends + menu ⋮ Block) · **Network** (badge request + tombol Add friend per kartu) · **Admin** (kolom + tab) · **Menu Profile** (Friends, Blocked)

> ⚠️ Kartu Network **tidak boleh** dibungkus satu `<Link>` (foto punya tombol; tombol di dalam link = HTML tak valid). Tombol Add friend **di luar** area link.

---

## 12. Rencana Bertahap

| Fase | Isi |
|---|---|
| **0. Bersih-bersih** | **Hapus invite-link (K7)** + **perbaiki `createInvite` tanpa guard**. Dilakukan **duluan** karena ini lubang yang sudah ada & bypass K3. |
| **1. Fondasi** | 3 tabel + enum notif + `ref_id` + view `v_friend_counts` + migrasi · server action (request/accept/reject/cancel/unfriend/block/unblock) dengan **advisory lock** + **conditional update** · helper: status relasi, penyaring blokir, `assertFriendableTarget` · anti-spam. **Belum ada UI.** |
| **2. Inti UI** | Profil publik · Network (tombol + badge) · `/profile/friends` · `/profile/blocked` · notifikasi |
| **3. Integrasi** | **Ekstrak helper undangan dulu** → guard K2 · guard K3 di `joinSession` · **saring blokir di 11 fungsi + 6 aksi** · story (urutan teman) · akun privat untuk teman |
| **4. Admin & pelengkap** | Kolom jumlah teman · tab Friends · daftar teman user lain |

---

## 13. Risiko Utama

| Risiko | Mitigasi |
|---|---|
| 🔴 **Blokir bocor** karena satu jalur terlewat (13+ jalur!) | **Ubah signature fungsi** agar viewer jadi parameter **wajib** → **TypeScript** yang menjaga, bukan disiplin manusia. Contoh nyata: `getLatestStoriesByBar` sekarang tak punya parameter viewer sama sekali. |
| 🔴 **Blokir gagal sebagai perlindungan** — yang diblokir masih bisa memaksa push ke HP korban | Guard mutasi di **6 aksi** (join, request-join, invite, rating, dst), bukan cuma filter tampilan. |
| 🔴 **Guard K3 terlewat di salah satu jalur masuk** | Pasang di **`joinSession`** (lapisan terbawah). Hapus `joinByCode` (K7). |
| 🔴 **Spam push** | Cooldown + kuota (K8). |
| 🟠 **Race mutual request** | Advisory lock per-pasangan. |
| 🟠 **Godaan kembali ke model 2-baris** | Sediakan view + helper di Fase 1. |
| 🟠 **Guard "hanya teman" terlewat di 1 dari 2 jalur undangan** | **Ekstrak helper dulu**, baru pasang guard sekali. |

---

## 14. Kriteria Selesai

**Friends**
- [ ] A kirim request → B dapat notif (bell + push) → B terima → berteman
- [ ] B sudah kirim duluan, A kirim juga → **langsung** jadi teman
- [ ] B tolak → A tak diberi tahu; **A tak bisa kirim ulang selama 1 hari**
- [ ] Kirim >20 request/hari → ditolak
- [ ] Unfriend → hilang dari kedua daftar
- [ ] Meja "friends": picker undangan **hanya** teman
- [ ] Meja "friends": bukan-teman **bisa lihat**, **tak bisa gabung** (semua jalur)
- [ ] Story teman di urutan depan
- [ ] Network: badge request + tombol Add friend (state benar)
- [ ] Profil: jumlah teman + tombol sesuai status
- [ ] Akun privat: teman lihat penuh; orang asing tertutup; **`hide_location` tetap tersembunyi bahkan dari teman**
- [ ] Admin: jumlah teman + tab daftar teman

**Block**
- [ ] Blokir → pertemanan putus + request dibatalkan
- [ ] Saling hilang dari Network, profil (404), story (**cek 5 jalur story**), **"Lagi di SOHO"**
- [ ] Yang diblokir **tak bisa**: kirim request · minta gabung meja korban · join meja korban · **beri rating** ke korban
- [ ] Yang diblokir **tak tahu** dia diblokir (tak ada error/push yang membocorkan)
- [ ] Sudah satu meja lalu blokir → **tetap** saling terlihat di meja itu
- [ ] `/profile/blocked` → lihat & buka blokiran
- [ ] A blokir B **dan** B blokir A → A buka blokir → **blokir B tetap berlaku**

**Pembersihan**
- [ ] `/join/[code]` & `joinByCode` **hilang**; tak ada kode dibuat lagi
- [ ] `createInvite` **hilang** (atau ber-guard host)
