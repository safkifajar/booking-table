# PRD — Host-Only Payment & QRIS Split Per-Anggota

**Status:** ✅ Confirmed — semua keputusan (Q1–Q6) terjawab. Siap untuk rencana
implementasi.
**Penulis:** Safki Fajar
**Tanggal:** 2026-07-12
**Area:** Session · Payment · QRIS (Duitku)
**Terkait:** [PRD Host-Only Order Control, Pay-Before-Order & Riwayat
Order-Payment](PRD-host-order-control-payment-history.md) — berbagi gate host,
`addOrderItem`, sumber `outstanding`, dan model riwayat. Lihat §12 di dokumen itu
& §0 di bawah untuk sinkronisasi.

---

## 0. Sinkronisasi dengan PRD Order Control (baca dulu)

Dokumen [PRD Host-Only Order Control & Riwayat
Order-Payment](PRD-host-order-control-payment-history.md) sudah **Confirmed** dan
menyentuh area yang sama. Empat titik integrasi yang **mengikat** PRD ini:

1. **Helper otorisasi host bersama.** Kedua PRD memakai pola "cek `host_id ===
   profile.id` di cabang customer, staff dikecualikan". **Implementasikan satu
   helper bersama** (mis. `assertHostOrStaff(sessionId, profile)` /
   `isSessionHost(...)`) dan pakai di **keduanya** — jangan tulis dua logika host
   yang bisa menyimpang. Ini menggantikan cara cek host ad-hoc di FR2/§7.2.
2. **`outstanding` sumber tunggal.** Perhitungan share split (PRD ini) dan gate
   pay-before-order (PRD order) sama-sama pakai
   `getOutstandingMap`/`computeBillTotals`. Jangan hitung ulang beda tempat.
3. **Payment `itemized` menulis `payment_items`.** PRD order menetapkan tabel
   baru `payment_items` yang **hanya** diisi untuk pembayaran `itemized`.
   Pembayaran split **my-order per-anggota** di PRD ini adalah `itemized` →
   **wajib menulis `payment_items`** untuk tiap item milik anggota tsb (agar
   riwayat rinci per-item konsisten). Pembayaran `equal`/`custom`/DP **tidak**
   menulis `payment_items` (tampil label+nominal saja).
4. **Definisi sesi walk-in / no-host konsisten.** Keduanya sepakat: sesi walk-in
   **tidak punya host customer** → **staff** yang generate pembayaran/QRIS &
   menambah order. Gate host-only (bayar & order) hanya berlaku di sesi customer.
5. **Hanya `paid` yang membuka gate pay-before-order — bukan `pending`.**
   Pembayaran split menghasilkan N payment **`pending`**; `outstanding` dihitung
   dari `Σ payment status='paid'` (`getOutstandingMap`), jadi split yang belum
   dibayar **tidak** mengurangi outstanding. Konsekuensi yang **disengaja**:
   selama masih ada pending/belum lunas, host **tidak** bisa menambah order
   (gate PRD order FR4 menolak). Host harus menunggu split benar-benar lunas
   dulu. Ini bukan bug — cegah menumpuk order di atas tagihan yang belum beres.
   *(Ditegaskan juga di PRD order FR4/FR5.)*
6. **Satu sumber kebenaran "host" = `table_sessions.host_id`.** Host tercatat di
   dua tempat (`table_sessions.host_id` **dan** `session_members.role='host'`).
   Helper otorisasi bersama (§0.1) dan **kedua** PRD **wajib** memakai
   `host_id` sebagai sumber tunggal (bukan `member.role`), agar tak ambigu.
7. **"Host ikut bayar" (Q3) tidak bentrok dengan host-only order.** Host tetap
   dapat QRIS bagiannya (payment) sekaligus memegang kontrol order — dua kapabilitas
   berbeda pada peran yang sama. Panel host menampilkan **QR host sendiri**
   (bukan QR anggota lain, Q1) **dan** kontrol tambah-order (bila `outstanding==0`).

> Urutan eksekusi: PRD order + helper otorisasi bersama + tabel `payment_items`
> lebih dulu (fondasi), lalu PRD ini menautkan payment split ke fondasi itu.

---

## 1. Ringkasan

Mengubah aturan pembayaran di dalam sesi meja sehingga **hanya host** yang dapat
membuat pembayaran / meng-generate QRIS. Ketika host memilih split (**Split
equally**) atau **My order (itemized)**, sistem membuat **satu pembayaran +
QRIS per anggota** sekaligus. Setiap anggota kemudian membuka aplikasinya dan
**hanya melihat QRIS miliknya sendiri** untuk dibayar. Seluruh anggota tetap
dapat melihat **riwayat pembayaran** meja (status siapa sudah/belum bayar).

Ini membalik perilaku saat ini, di mana **setiap anggota** yang joined bisa
memicu pembayaran untuk dirinya sendiri.

---

## 2. Latar Belakang & Masalah

### 2.1 Perilaku sekarang (as-is)
- Payment sudah **per-anggota**: `payments.paid_by_member_id` → `session_members.id`
  (`src/lib/db/schema/orders.ts:92-116`).
- Satu sesi = **satu order terbuka** (`uq_open_order_per_session`,
  `src/lib/db/schema/orders.ts:39-41`). Bill dilunasi oleh beberapa payment
  anggota terhadap order yang sama.
- **Siapa pun anggota joined** (bukan hanya host) bisa memanggil `payShare`
  dan bikin pembayaran untuk dirinya sendiri. Tidak ada gate host di UI maupun
  server (`src/lib/actions.ts:1667-1813`; gate UI hanya `isMember || isStaff`
  di `src/app/session/[id]/SessionView.tsx:246-259`).
- **Split equally** saat ini hanya membuat **1 payment** (untuk si pembayar,
  sebesar `ceil(total / jumlahAnggota)`), **bukan** 1 payment per anggota
  (`src/components/session/SplitPayment.tsx:122-124`, `payShare` insert tunggal).
- QRIS + expiry + metadata disimpan di `payments.split_meta` (jsonb), bukan
  kolom tersendiri (`qrString`, `expiresAt`, `merchantOrderId`, `isDownPayment`).
- Riwayat pembayaran ("Payments received") menampilkan **semua** payment order
  ke semua anggota — sudah sesuai kebutuhan (`SplitPayment.tsx:417-515`).

### 2.2 Masalah / kebutuhan
1. Kontrol pembayaran tersebar — tiap anggota bisa memicu bayar sendiri-sendiri,
   sulit dikoordinasikan. Host ingin jadi satu-satunya pemegang kendali
   pembayaran meja.
2. Split equally tidak benar-benar men-split ke tiap anggota; hanya menghitung
   nominal untuk 1 orang. Tidak ada QRIS terpisah per anggota.
3. Belum ada mekanisme "tiap anggota lihat QRIS-nya sendiri".

---

## 3. Tujuan & Non-Tujuan

### 3.1 Tujuan
- **G1** — Hanya host sesi yang boleh membuat pembayaran / generate QRIS
  (enforce di UI **dan** server).
- **G2** — Saat host pilih **Split equally** atau **My order**, sistem
  meng-generate **satu pembayaran + satu QRIS untuk tiap anggota** dalam satu
  aksi (batch).
- **G3** — Tiap anggota hanya melihat **QRIS miliknya sendiri** (payment yang
  `paid_by_member_id`-nya = anggota tsb). Anggota lain tidak melihat gambar QR
  itu.
- **G4** — Semua anggota tetap dapat melihat **riwayat/daftar pembayaran** meja
  beserta statusnya (paid/pending/expired, nominal, nama pemilik).
- **G5** — Tidak merusak flow eksisting: DP booking, pembayaran oleh kasir/
  waiter (`payFullOnly`), callback Duitku, polling status.

### 3.2 Non-Tujuan
- Tidak mengubah gateway (tetap Duitku untuk QRIS; mock untuk dev).
- Tidak menambah metode bayar baru (tetap QRIS-only di UI customer).
- Tidak mengubah alur kasir/waiter menerima pembayaran tunai/penuh di meja.
- Tidak menambah refund/partial-void.
- Tidak mengubah cara host ditetapkan (`table_sessions.host_id` +
  `session_members.role = 'host'`).

---

## 4. Persona & Peran

| Peran | Kemampuan bayar (setelah PRD) |
|---|---|
| **Host** (`host_id` = profile) | Satu-satunya yang bisa memicu pembayaran/generate QRIS: bayar penuh, split equally (batch per-anggota), atau my-order (batch per-anggota). |
| **Anggota / member** (joined, bukan host) | **Tidak** bisa memicu pembayaran. Hanya melihat QRIS miliknya (yang di-generate host) + melihat riwayat. |
| **Guest** (walk-in tanpa akun) | Sama seperti member; tidak bisa memicu bayar. |
| **Staff** (kasir/waiter) | **Tetap bisa GENERATE pembayaran/QRIS** — gate host-only **tidak** berlaku untuk staff. Kasir lewat jalurnya sendiri (`CashierPaymentPanel` → `cashier-actions`), waiter lewat `payShare` cabang staff (`payFullOnly`). **Baru:** dapat **menampilkan QRIS milik anggota mana pun** yang di-generate host (semua tipe pembayaran) untuk membantu anggota yang tak bisa menampilkan QR-nya sendiri (mis. mabuk/HP mati/walk-in guest). |

---

## 5. Persyaratan Fungsional

### 5.1 Gate "Host-only" untuk aksi pembayaran
- **FR1.** UI: panel/tombol pembuatan pembayaran (pilih split type, pilih
  method, tombol "Pay") **hanya muncul** untuk host. Non-host melihat panel
  read-only: ringkasan tagihan + QRIS miliknya (bila ada) + riwayat.
- **FR2.** Server: `payShare` (atau action baru) **menolak** pemanggil yang
  **customer bukan-host**. Gate berbunyi: **"harus HOST sesi ATAU staff aktif di
  bar"** (bukan lagi "harus member"). Aturan lama = "member mana pun boleh";
  aturan baru = host-only untuk customer, staff tetap boleh.
- **FR2a. (PENTING — jangan blokir staff).** Gate host-only **hanya** berlaku
  pada jalur **customer**. Staff (kasir/waiter) **tetap bisa generate
  pembayaran/QRIS**:
  - **Kasir** memakai jalur terpisah (`CashierPaymentPanel` →
    `cashier-actions.ts:816-838`), **tidak** lewat `payShare` — tak tersentuh
    gate ini.
  - **Waiter** lewat `payShare` cabang staff yang sudah ada
    (`actions.ts:1690-1726`): pemanggil staff aktif di bar diizinkan &
    diatribusikan ke host member.
  - Implementasi cek host **harus** ditempatkan di cabang "pemanggil = member",
    **bukan** menggantikan/mem-bypass cabang staff. Cabang staff dipertahankan
    apa adanya.
- **FR3.** Pesan error jelas ketika non-host mencoba (mis. "Hanya host yang bisa
  membuat pembayaran").

### 5.2 Split → batch payment + QRIS per anggota
- **FR4.** Mode **Split equally**: host memicu satu aksi; sistem membuat N
  pembayaran `pending` (N = jumlah anggota joined), masing-masing:
  - `paid_by_member_id` = anggota ke-i
  - `amount` = bagian anggota tsb (lihat aturan pembulatan FR7)
  - `split_mode = 'equal'`
  - masing-masing memanggil gateway → menghasilkan QRIS + `expiresAt` sendiri,
    disimpan di `split_meta` seperti sekarang.
- **FR5.** Mode **My order (itemized)**: sistem membuat pembayaran hanya untuk
  anggota yang **punya item** (dari `order_items.added_by_member_id`), sebesar
  total item masing-masing; anggota tanpa item tidak dapat payment. Setiap
  payment `split_mode = 'itemized'` + QRIS sendiri.
  - **Integrasi (§0.3):** karena ini `itemized`, tiap payment **wajib menulis
    baris `payment_items`** untuk tiap item milik anggota tsb (nama/qty/amount),
    dalam transaksi yang sama — agar riwayat rinci per-item konsisten dgn PRD
    order.
- **FR6.** Mode **My treat / bayar penuh** (`custom`): tetap **1 payment** untuk
  host sebesar sisa tagihan (tidak di-split). QRIS tunggal, dilihat host.
- **FR7. Pembulatan & anti over-payment:**
  - Total yang di-generate untuk semua anggota **tidak boleh melebihi**
    `remaining`. Selisih pembulatan (`ceil`) dibebankan/diserap agar jumlah
    seluruh share = `remaining` (mis. anggota terakhir menyerap sisa selisih).
  - Jika bill sudah lunas (`remaining <= 0`), aksi split ditolak.
- **FR7a. Basis Split equally = `total` (Q5).** Bagian tiap anggota dihitung
  dari **`total` penuh dibagi jumlah anggota** (`ceil(total / N)`), **bukan**
  `remaining`. Konsekuensi yang harus ditangani:
  - Jika sudah ada DP/pembayaran sebelumnya, jumlah seluruh share (= `total`)
    bisa **melebihi `remaining`** → menimbulkan over-payment. Karena itu, per
    payment tetap **di-cap ke sisa `remaining`** saat charge, dan share terakhir
    diserap agar total charge = `remaining` (konsisten dgn FR7). *(Artinya: basis
    hitung per-orang = `total/N`, tetapi total yang benar-benar ditagih ke meja
    tidak melebihi `remaining`.)*
  - Anggota yang sudah pernah membayar tetap ikut dihitung `total/N`; koordinasi
    siapa yang benar-benar perlu bayar diserahkan ke host (host melihat status).
- **FR7b. Skema/action batch berbeda dari `payShare` sekarang.** `paySchema`
  saat ini (`actions.ts:1645-1651`) menerima **satu** `amount` untuk **satu**
  pembayaran. Batch (N payment) butuh **action baru** (mis. `createSplitBatch`)
  yang menghitung N share di server + loop `createCharge`. `payShare` lama tetap
  dipakai untuk `custom`/staff (1 payment). Jangan paksakan batch ke schema
  amount-tunggal.
- **FR8. Idempotensi/duplikasi:** jika sudah ada payment `pending` yang belum
  expired untuk anggota tertentu pada order ini, sistem **tidak** membuat
  duplikat untuk anggota itu (skip atau re-use). Mencegah host menekan "Split"
  dua kali membuat 2× QRIS per anggota.

### 5.3 Visibilitas QRIS per anggota
- **FR9.** Ketika anggota (non-host) membuka sesi, ia melihat **QRIS-nya
  sendiri** jika ada payment `pending` dengan `paid_by_member_id` = dirinya
  (auto-tampilkan / tombol "Show QR"). Ia **tidak** melihat gambar QR anggota
  lain.
- **FR9a. (GAP — wajib).** Payload payment yang dikirim ke klien **saat ini
  TIDAK memuat `paid_by_member_id`** (`page.tsx:338-359` hanya mengirim
  `paid_by` = display_name). Tanpa ini, klien **tidak bisa** menentukan payment
  mana milik anggota yang sedang login → filter QR (FR9/FR11) mustahil. **Wajib
  tambahkan `paid_by_member_id`** ke payload payment (dan ke `interface Payment`
  di `SplitPayment.tsx`). Ini prasyarat semua logika visibilitas per-anggota.
- **FR10.** Host melihat status seluruh split (siapa sudah bayar / pending),
  namun **tidak** dapat melihat gambar QR anggota lain (Q1 = tidak bisa). Host
  hanya melihat QR miliknya sendiri (bagian host, karena host ikut membayar —
  Q3) + status seluruh anggota. Gambar QR anggota lain disembunyikan dari host.
- **FR11.** Payload sensitif (`qr_string`) untuk payment anggota **tidak boleh
  dikirim ke klien anggota lain maupun host**. Data fetch untuk klien customer
  (host/anggota) harus memfilter `qr_string` agar hanya diserahkan ke
  **pemiliknya** (server-side filtering pada `page.tsx`).

### 5.3a Staff (kasir/waiter) menampilkan QRIS anggota
> Requirement tambahan: bantu anggota yang tak bisa menampilkan QR-nya sendiri
> (mabuk, HP mati, walk-in guest tanpa device).

- **FR11a.** Di panel staff (kasir & waiter), staff dapat **menampilkan QRIS
  milik anggota mana pun** pada sesi/meja tsb — untuk **semua tipe pembayaran**
  (equal, itemized, custom/treat, DP), selama payment masih `pending` dan belum
  expired.
- **FR11b.** Panel staff menampilkan **daftar payment pending per anggota**
  (nama anggota + nominal + status) dengan tombol "Show QR" per baris. Staff
  memilih anggota → QRIS anggota tsb ditampilkan di layar staff untuk di-scan
  tamu.
- **FR11c.** Berbeda dengan klien customer (FR11), fetch untuk **staff** boleh
  menyertakan `qr_string` semua anggota (staff tepercaya). Otorisasi: hanya
  staff **aktif di bar sesi tsb** (`staff_roles.is_active` + `bar_id` cocok).
- **FR11d.** Kasir sudah punya `CashierPaymentPanel` + `getSessionDetailForCashier`
  yang meng-expose `qr_string` (`src/lib/cashier-actions.ts:669-682`); perluas
  agar mencakup **QR per anggota** (bukan hanya QR pembayaran yang dibuat kasir).
  Sediakan panel setara untuk **waiter**.

### 5.4 Riwayat pembayaran (tetap terlihat semua)
- **FR12.** Daftar "Payments received" tetap menampilkan **semua** payment order
  ke semua anggota: nama pemilik, nominal, method, split-mode, status
  (paid/pending/expired), waktu, ID transaksi. **Tanpa** `qr_string` untuk yang
  bukan miliknya.
- **FR13.** Ketika satu anggota membayar (callback Duitku sukses), status di
  daftar ter-update untuk semua anggota (revalidate/realtime seperti sekarang).

### 5.5 Realtime & notifikasi
- **FR14.** Setelah host generate split, tiap anggota mendapat sinyal (realtime
  refresh yang sudah ada di `/api/realtime/session/[id]`) agar QRIS-nya muncul
  tanpa reload manual.
- **FR15.** Notifikasi ke host + staff saat ada pembayaran lunas
  (`notifySessionAndStaff`) dipertahankan.

---

## 6. Persyaratan Non-Fungsional
- **NFR1. Keamanan:** otorisasi host dilakukan di server (jangan hanya UI).
  `qr_string` anggota tidak bocor ke klien lain.
- **NFR2. Idempotensi callback:** `markPaymentPaidBySystem` sudah idempotent —
  batch tidak boleh melanggarnya. Tiap payment punya `merchantOrderId` =
  `paymentId` sendiri (`gateway.ts`).
- **NFR3. Konsistensi:** pembuatan N payment sebaiknya dalam transaksi; kegagalan
  parsial harus dapat dipulihkan (tidak meninggalkan sebagian anggota tanpa QR
  tanpa penanda).
- **NFR4. Batas gateway:** N panggilan `createCharge` (satu per anggota) — untuk
  meja kecil (≤ kapasitas meja) volumenya rendah; tidak butuh optimasi khusus,
  tapi tangani error per-anggota (satu gagal tak menggagalkan semua).

---

## 7. Perubahan Teknis (High-Level)

> Detail implementasi final ditentukan saat eksekusi; ini peta dampak.

### 7.1 Data
- **Tidak wajib** migrasi schema. Model `payments` sudah per-member dan sudah
  simpan QRIS di `split_meta`. Split batch = beberapa baris `payments` untuk satu
  order.
- **Wajib (Q2):** tambah penanda `split_meta.batchId` (uuid) untuk
  mengelompokkan payment yang lahir dari satu aksi split. Dipakai untuk fitur
  **"Batalkan seluruh split"** (void semua payment pending dalam batch).

### 7.2 Server actions (`src/lib/actions.ts`)
- **Ubah `payShare`** (atau tambah `payAsHost` / `createSplitPayments`):
  - Cabang **member** (`actions.ts:1679-1688`): tambahkan cek host memakai
    **helper otorisasi bersama** (§0.1) — jangan tulis cek host ad-hoc terpisah
    dari PRD order. Non-host ditolak.
  - Cabang **staff** (`actions.ts:1690-1726`): **JANGAN diubah** — staff tetap
    boleh generate, diatribusikan ke host member (FR2a).
  - Untuk payment `itemized`: **tulis `payment_items`** (§0.3, FR5).
  - Untuk `equal`/`itemized`: loop anggota (atau anggota-dengan-item), insert
    payment + panggil gateway per anggota, kumpulkan hasil. Anti-duplikat (FR8).
  - Untuk `custom`: seperti sekarang (1 payment host).
- **Ubah fetch di `page.tsx`** (`src/app/session/[id]/page.tsx:203-224, 338-359`):
  - **Tambahkan `paid_by_member_id`** ke payload payment (prasyarat, FR9a) —
    kolomnya sudah ada di DB tapi tidak ikut di-`select`/mapping.
  - Saat memetakan payments untuk **klien customer** (host/anggota), **hilangkan
    `qr_string`** pada payment yang `paid_by_member_id` ≠ anggota si pemanggil
    (termasuk host — host tak lihat QR anggota lain, Q1). Status & nominal tetap
    dikirim.
- **Fetch staff** (`getSessionDetailForCashier` + panel waiter baru): **boleh**
  menyertakan `qr_string` **semua** anggota (FR11a–d). Otorisasi staff aktif di
  bar sesi.
- **Action baru `cancelSplitBatch(batchId)`** (Q2): void semua payment `pending`
  dalam satu batch (host-only). Set status `failed`/`cancelled`, hentikan QR.

### 7.3 UI (`SplitPayment.tsx` + `SessionView.tsx`)
- Tambah prop `isHost` ke `SplitPayment`. Sembunyikan seluruh blok
  pemilihan/aksi bayar untuk non-host (FR1).
- Non-host: render "Your QR" (payment pending miliknya) + ringkasan tagihan +
  riwayat.
- Host: mode `equal`/`itemized` memicu **satu** panggilan yang menghasilkan
  batch; UI menampilkan konfirmasi "QRIS terkirim ke N anggota" dan daftar
  status. Host tidak perlu melihat QR anggota lain (FR10).
- `payFullOnly` (staff) tidak berubah.

### 7.4 UI Staff (kasir/waiter)
- Perluas `CashierPaymentPanel` (`src/components/cashier/CashierPaymentPanel.tsx`)
  agar menampilkan daftar payment pending **per anggota** dengan tombol "Show QR"
  masing-masing (FR11b). Re-use `QrisPaymentDialog`.
- Sediakan panel setara di sisi **waiter** (saat ini waiter mendapat
  `SplitPayment` dengan `payFullOnly`; tambahkan bagian "QR anggota" read-only).

### 7.5 Realtime
- Manfaatkan channel `/api/realtime/session/[id]` yang ada untuk push refresh ke
  anggota setelah batch dibuat.

---

## 8. Alur Pengguna (User Flows)

### 8.1 Host — Split equally
1. Host buka tab pembayaran → pilih **Split equally** → pilih **QRIS** → "Pay".
2. Sistem hitung bagian tiap anggota (anti-pembulatan-lebih), buat N payment
   pending + N QRIS.
3. Host melihat konfirmasi + daftar status ("Andi: pending, Budi: pending, …").
4. Tiap anggota mendapat refresh; membuka app → melihat **QRIS-nya sendiri**.

### 8.2 Anggota (non-host)
1. Buka sesi → tab pembayaran read-only.
2. Jika host sudah split → **QRIS milik saya** tampil (scan & bayar).
3. Jika belum → tampil pesan "Menunggu host membuat pembayaran".
4. Selalu bisa melihat **riwayat** siapa sudah bayar.

### 8.3 Host — My order (itemized)
- Sama seperti 8.1, tapi payment hanya untuk anggota yang punya item; nominal =
  total item masing-masing.

### 8.4 Host — My treat (bayar penuh)
- 1 QRIS untuk host sebesar sisa tagihan. Anggota tak perlu bayar.

### 8.5 Staff bantu tampilkan QR anggota (kasir/waiter)
1. Anggota tak bisa menampilkan QR-nya sendiri (mabuk / HP mati / walk-in guest).
2. Staff buka panel meja → daftar payment pending per anggota.
3. Staff pilih anggota tsb → tekan "Show QR" → QRIS anggota tampil di layar
   staff → tamu scan & bayar.
4. Berlaku untuk **semua tipe** payment (equal/itemized/custom/DP) selama
   pending & belum expired.

> **Q3 (host ikut bayar):** Pada Split equally, host **ikut** mendapat QRIS
> bagiannya dan membayar seperti anggota lain (host memicu split sekaligus jadi
> salah satu pembayar). Lihat 8.1.

---

## 9. Edge Cases
- **Bill sudah lunas** saat host menekan split → tolak (FR7).
- **Anggota keluar/masuk** setelah split dibuat → payment lama tetap; host boleh
  generate ulang untuk anggota baru (anti-duplikat per anggota tetap berlaku).
- **QR expired** sebelum dibayar → sama seperti sekarang (polling `checkPaymentStatus`
  set `failed`, badge jadi "cancelled"; host dapat generate ulang).
- **My order tapi ada item "milik meja"/tak ber-owner** → tentukan: dibebankan
  ke host atau diabaikan (default: item selalu punya `added_by_member_id`, jadi
  tak ada yatim; sisa pembulatan diserap host).
- **Walk-in guest tanpa device (Q4)** → walk-in dibuat lewat waiter dengan
  **guest profile placeholder** (`is_guest=true`) + **punya `session_members`
  row** (`waiter-actions.ts:697,774`). Jadi guest **punya `paidByMemberId`** dan
  QR-nya bisa dibuat & ditampilkan staff. Karena tak punya app sendiri, QR-nya
  ditampilkan lewat panel staff (8.5 / FR11a) untuk di-scan.
- **Sesi walk-in tidak punya host aktif (Q6)** → pada sesi yang dibuka staff,
  **tidak ada host customer** yang mengoperasikan pembayaran. **Staff** yang
  mengurus seluruh pembayaran (generate + tampilkan QR) lewat **jalur staff**
  (FR2a). Fitur "host generate split" dari sisi customer **tidak berlaku** di
  sesi walk-in. Gate host-only hanya relevan pada sesi customer (host = customer
  asli yang buka meja via scan QR).
- **Host juga anggota yang punya item** → host tetap dapat QRIS bagiannya
  sendiri seperti anggota lain (host memicu, tapi tetap ikut membayar bagiannya).
- **Sebagian gateway call gagal** saat batch → payment yang gagal ditandai/di-
  rollback; host diberi tahu anggota mana yang perlu di-retry (NFR3).
- **Staff (`payFullOnly`)** → jalur terpisah, tidak terpengaruh gate host.

---

## 10. Kriteria Penerimaan (Acceptance)
1. Anggota non-host **tidak** menemukan tombol/aksi membuat pembayaran; upaya
   langsung ke server ditolak.
2. Host memicu **Split equally** → tercipta N payment pending, jumlah share =
   `remaining` (tanpa over-payment), tiap anggota punya QRIS.
3. Anggota A membuka app → melihat **hanya** QRIS-nya; response klien anggota A
   **tidak** memuat `qr_string` milik anggota B.
4. Semua anggota melihat daftar riwayat + status yang sama, ter-update saat ada
   yang membayar.
5. My order menghasilkan payment hanya untuk anggota ber-item, nominal benar.
6. My treat tetap 1 QRIS untuk host.
7. Host **tidak** dapat melihat gambar QR anggota lain (hanya status + QR
   miliknya sendiri).
8. **Staff (kasir & waiter)** tetap dapat **GENERATE** pembayaran/QRIS tanpa
   terblokir gate host-only (kasir via jalurnya sendiri, waiter via cabang staff
   `payShare`).
9. **Staff (kasir & waiter)** dapat **menampilkan** QRIS milik anggota mana pun
   (semua tipe pembayaran, selama pending & belum expired).
10. Host dapat **membatalkan seluruh split** (batch) → semua payment pending di
    batch tsb berhenti (status non-pending, QR mati).
11. Flow DP booking, kasir/waiter (`payFullOnly`), callback Duitku, polling
    status tetap berfungsi tanpa regresi.

---

## 11. Keputusan (semua terkonfirmasi)
- **Q1 — Host lihat QR anggota lain?** → **Tidak.** Host hanya lihat QR miliknya
  + status seluruh anggota. (FR10, FR11.)
- **Q2 — Tombol "Batalkan seluruh split"?** → **Perlu.** Butuh `split_meta.batchId`
  + action `cancelSplitBatch(batchId)` (host-only). (7.1, 7.2.)
- **Q3 — Host ikut bayar bagiannya?** → **Ikut.** Pada Split equally, host juga
  dapat QRIS bagiannya dan membayar seperti anggota lain. (8.1, 8.5.)
- **Q4 — Guest walk-in tanpa device?** → **Lewat waiter/kasir.** Staff
  menampilkan QRIS guest lewat panel staff untuk di-scan. (§5.3a, 8.5.) Guest
  punya member row → punya `paidByMemberId` (Edge Cases §9).

### 11.1 Pertanyaan dari review teknis (terjawab)
- **Q5 — Basis Split equally.** → **Dari `total`.** Bagian per anggota =
  `ceil(total / N)`. Total charge ke meja tetap di-cap ke `remaining` untuk cegah
  over-payment. (FR7a.)
- **Q6 — Host pada sesi walk-in (dibuka staff).** → **Tidak ada host.** Pada sesi
  walk-in, **staff** yang mengurus seluruh pembayaran (jalur staff). Fitur host
  generate split tidak berlaku di sesi walk-in. (Edge Cases §9, FR2a.)
