# PRD — Host-Only Order Control, Pay-Before-Order & Riwayat Order-Payment

**Status:** ✅ Confirmed — semua keputusan (Q1–Q4) terjawab. Siap eksekusi.
**Penulis:** Safki Fajar
**Tanggal:** 2026-07-12
**Area:** Session · Order · Payment · Admin/Staff history
**Terkait:** [PRD Host-Only Payment & QRIS Split](PRD-host-only-payment-split-qris.md)
(dokumen ini menyentuh gate host & `addOrderItem` yang sama — lihat §12 Interaksi)

---

## 1. Ringkasan

Tiga perubahan pada flow detail meja (customer):

1. **Hanya host yang bisa menambah order.** Anggota biasa tidak lagi bisa
   menambah item; hanya host (dan staff atas nama meja) yang menambah pesanan.
2. **Pay-before-order (lunasi sisa dulu).** Jika masih ada **sisa tagihan
   setelah DP** (outstanding > 0), host **harus melunasi dulu** sebelum bisa
   menambah order baru. DP awal tidak menghalangi order pertama; yang dijaga
   adalah penambahan order berikutnya ketika ada tunggakan.
3. **Riwayat Order-Payment (payment + rincian item).** Daftar pembayaran yang
   tiap barisnya bisa di-expand untuk melihat **item order apa saja** yang
   dicakup pembayaran itu beserta nominalnya. Dapat dilihat oleh **customer,
   kasir, waiter, admin** (per meja / per transaksi), dan **tiap staff**.

---

## 2. Latar Belakang & Masalah (as-is)

- **Tambah order tidak dibatasi host.** `addOrderItem`
  (`src/lib/actions.ts:1481-1565`) mengizinkan **setiap** `joined` member
  menambah item (`actions.ts:1521-1533`). Ada cabang staff-on-behalf
  (`onBehalfOfMemberId`, `actions.ts:1491-1519`). Tidak ada pembedaan host vs
  member.
- **Tidak ada gate "harus lunas".** Tidak ada pengecekan outstanding sebelum
  menambah item. Bahkan setelah lunas, UI menganjurkan "keep ordering"
  (`SplitPayment.tsx:253-255`). Satu-satunya alasan gagal: bukan member, tak ada
  open order, atau menu tak tersedia.
- **DP & outstanding.** DP = 1 baris `payments` `custom` dengan
  `split_meta.isDownPayment=true`; saat lunas set `tableSessions.dpPaidAt`
  (`actions.ts:494-569`). Outstanding = `total − Σ(paid)` termasuk DP
  (`getOutstandingMap`, `queries.ts:240-296`; `computeBillTotals`,
  `settings-constants.ts:123-143`). **Tidak ada** field "sisa setelah DP"
  terpisah — semuanya satu `outstanding`.
- **Riwayat.** Payment log ada (`SplitPayment.tsx` "Payments received"). Bill tab
  menampilkan item **grup per-member** (snapshot, bukan feed). **Tidak ada
  penautan payment → item** di mana pun — kita tak tahu satu pembayaran mencakup
  item apa. Admin `getTransactionDetail` (`admin.ts:650-875`) punya `items[]` &
  `payments[]` tapi **terpisah**, tak ditautkan.

### 2.1 Masalah
1. Kontrol order tersebar ke semua member → host ingin kendali penuh order.
2. Meja bisa terus menambah order sambil menunggak → risiko tak tertagih.
3. Tak ada cara melihat "pembayaran ini untuk item apa" — menyulitkan audit,
   rekonsiliasi kasir, dan transparansi ke customer.

---

## 3. Tujuan & Non-Tujuan

### 3.1 Tujuan
- **G1** — `addOrderItem` (jalur customer) **hanya untuk host**; anggota lain
  ditolak (UI + server). Cabang staff dipertahankan.
- **G2** — Sebelum menambah order, jika `outstanding > 0` → **tolak** hingga
  dilunasi (pay-before-order). Berlaku pada jalur customer/host.
- **G3** — Model + UI **Riwayat Order-Payment**: tiap payment dapat di-expand
  → daftar item yang dicakup + nominal. Terlihat oleh customer/host, staff
  (kasir & waiter), dan admin (per meja/transaksi).
- **G4** — Tidak merusak flow eksisting: DP booking, order pertama saat open,
  pembayaran kasir/waiter, split (PRD terkait), callback/polling.

### 3.2 Non-Tujuan
- **Bukan** "bayar untuk menambah user" — konsep pay-per-member **dibatalkan**
  (klarifikasi user: yang dimaksud adalah *order*, bukan *user*).
- Tidak mengubah cara user join/invite (kapasitas, invite code) — di luar scope.
- Tidak mengubah gateway atau metode bayar.
- Tidak menambah atribusi per-cashier (`processed_by_id`) — gap terpisah
  (§11), kecuali diputuskan masuk.
- Tidak membuat refund/void baru.

---

## 4. Persona & Peran

| Peran | Tambah order | Bayar/lunasi | Lihat Riwayat Order-Payment |
|---|---|---|---|
| **Host** | ✅ (satu-satunya customer yang bisa) | ✅ (sesuai PRD host-only payment) | ✅ meja sendiri |
| **Anggota/member** | ❌ | (sesuai PRD host-only) | ✅ meja sendiri (read-only) |
| **Staff (waiter/kasir)** | ✅ atas nama meja (`onBehalfOfMemberId`) | ✅ | ✅ semua meja di bar-nya |
| **Admin/manager** | — | — | ✅ semua meja/transaksi di bar |

---

## 5. Persyaratan Fungsional

### 5.1 Host-only tambah order
- **FR1.** Jalur customer `addOrderItem`: caller **harus host** sesi (bukan
  sekadar joined member). Non-host ditolak: "Hanya host yang bisa menambah
  pesanan." **Sumber kebenaran host = `table_sessions.host_id === profile.id`**
  (bukan `session_members.role='host'`), lewat helper otorisasi bersama —
  konsisten dgn PRD host-only §0.1 & §0.6.
- **FR2.** Cabang staff (`onBehalfOfMemberId`, `actions.ts:1491-1519`)
  **tidak diubah** — staff tetap bisa input atas nama meja.
- **FR3.** UI: menu/keranjang untuk menambah item **hanya aktif** untuk host
  (dan staff). Anggota non-host melihat menu read-only / pesan "Hanya host yang
  bisa memesan; minta host menambahkan." (Ganti gate `canInteract`/`isMember`
  di `SessionView.tsx:1260-1291` menjadi host-or-staff untuk aksi order.)

### 5.2 Pay-before-order (lunasi sisa dulu)
- **FR4.** Sebelum insert order item (jalur customer/host), hitung `outstanding`
  sesi (reuse `getOutstandingMap`/logika `remaining`). Jika `outstanding > 0`
  → **tolak**: "Lunasi dulu sisa tagihan Rp X sebelum menambah pesanan."
  - **Hanya `paid` yang membuka gate (bukan `pending`).** `outstanding` hanya
    berkurang oleh payment berstatus **`paid`**. Split yang menghasilkan payment
    **`pending`** (PRD host-only) **tidak** membuka gate — host harus menunggu
    split benar-benar lunas sebelum bisa menambah order. Disengaja, bukan
    deadlock: host boleh membatalkan split (cancelSplitBatch) lalu bayar penuh,
    atau tunggu anggota melunasi. *(Selaras PRD host-only §0.5.)*
- **FR5.** **DP tidak menghalangi.** Aturan berbasis `outstanding`
  (`total − Σ paid`, DP sudah termasuk paid). Jadi:
  - Saat awal (baru DP dibayar, order awal ada) → outstanding = total − DP,
    mungkin > 0. **Namun** ini order pertama saat open (via `openTable`, bukan
    `addOrderItem`) sehingga tidak terkena gate. Gate hanya untuk penambahan
    **berikutnya** lewat `addOrderItem`.
  - Jika host mau nambah order lagi sementara masih ada sisa → harus lunasi
    sisa itu dulu.
- **FR6.** Gate ini **server-side** (di `addOrderItem`), bukan hanya UI. UI juga
  menandai: tombol "Tambah pesanan" disabled + alasan bila `outstanding > 0`.
- **FR7. Staff dikecualikan (Q1).** Staff yang input atas nama meja
  (`onBehalfOfMemberId`) **tidak** terkena gate pay-before-order — staff tetap
  bisa menambah order meski ada sisa (tamu lanjut pesan, bayar di kasir
  belakangan). Gate pay-before-order **hanya** untuk jalur customer/host.

### 5.3 Riwayat Order-Payment (payment + rincian item)
- **FR8. Penautan payment → item** via tabel `payment_items` (§7.1). Diisi
  **hanya** untuk pembayaran `itemized`/"my order".
- **FR9. Aturan tampilan (Q2B).** Tiap baris pembayaran di riwayat:
  - **`itemized` / "my order"** → **expandable**, menampilkan daftar item yang
    dibayar (nama, qty, nominal) dari `payment_items`.
  - **DP / `equal` / `custom` (treat)** → tampilkan **hanya label + nominal**
    (mis. "DP — Rp 50.000", "Split rata — Rp 100.000", "Treat — Rp 200.000").
    **Tanpa** daftar item. Tidak ada alokasi proporsional.
  - Payment lama tanpa `payment_items` → seperti baris tanpa rincian.
- **FR9a. QRIS untuk payment pending (Q3).** Jika pembayaran masih `pending` dan
  belum expired, baris riwayat menyediakan tombol **"Show QR"** untuk
  menampilkan QRIS-nya (reuse `QrisPaymentDialog`, `qr_string` dari
  `split_meta`). Berlaku di sisi **customer (pemilik QR)** — konsisten dgn PRD
  host-only (FR9/FR11 di sana) — **dan sisi staff** (kasir/waiter boleh tampilkan
  QR anggota mana pun untuk bantu bayar). Ini menyatukan "riwayat" + "tampilkan
  QR" dalam satu daftar.
- **FR10. Tampilan (staff — kasir & waiter).** `getSessionDetailForCashier`
  (`cashier-actions.ts:511-706`) sudah mengirim `items[]` & `payments[]`;
  tambahkan `payment_items` + UI expandable yang sama + tombol Show QR (FR9a).
  Berlaku untuk **kasir dan waiter**.
- **FR11. Tampilan (admin).** `getTransactionDetail` (`admin.ts:650-875`)
  perluas agar payment `itemized` menampilkan item yang dicakup (dari
  `payment_items`); UI di `/admin/transactions/[id]`. Admin melihat ini **per
  meja / per transaksi** (Q4 = default per-transaksi).
- **FR12. Akses "tiap staff".** Setiap staff (waiter/kasir) dapat membuka
  riwayat order-payment untuk sesi/meja di bar-nya (read-only, + Show QR untuk
  pending). Bukan atribusi per-staff (Q3 = tak ada `processed_by_id` baru).
- **FR13.** Riwayat tetap menampilkan status (paid/pending/expired), metode,
  waktu, ID transaksi, pemilik (`paid_by`) seperti sekarang.

---

## 6. Persyaratan Non-Fungsional
- **NFR1. Keamanan/otorisasi server:** gate host-only & pay-before-order
  ditegakkan di server (`addOrderItem`), bukan hanya UI.
- **NFR2. Konsistensi:** perhitungan outstanding untuk gate memakai sumber yang
  sama dengan tampilan bill (`getOutstandingMap`/`computeBillTotals`) agar tak
  ada selisih antara "yang ditampilkan" vs "yang di-enforce".
- **NFR3. Kompatibel mundur:** payment lama (tanpa penautan item) tetap tampil;
  yang tak punya tautan item ditampilkan tanpa rincian (graceful).
- **NFR4. Race:** dua penambahan order + pembayaran bersamaan tak boleh
  menembus gate (cek outstanding sedekat mungkin dengan insert).

---

## 7. Perubahan Teknis (High-Level)

### 7.1 Model penautan payment ↔ item — **tabel baru `payment_items` (Q2A)**
Buat tabel join ternormalisasi (butuh migrasi Drizzle):

```
payment_items
  id             uuid PK
  payment_id     uuid  -> payments.id       (on delete cascade)
  order_item_id  uuid  -> order_items.id     (on delete restrict)
  amount         int   -- nominal item yang dicakup pembayaran ini (check > 0)
  created_at     timestamptz default now()
  UNIQUE (payment_id, order_item_id)
  index (payment_id), index (order_item_id)
```

- **Kapan diisi:** hanya untuk pembayaran yang **memang berbasis item** =
  **`itemized` / "my order"**. Saat payment itemized dibuat, insert satu
  `payment_items` per item yang dibayar (dari `order_items` milik member ybs),
  `amount = qty × unit_price`.
- **DP / `equal` / `custom` (treat) → TIDAK menulis `payment_items`** (Q2B).
  Pembayaran itu tidak 1:1 ke item tertentu; di riwayat ditampilkan **hanya
  nominal + label** (lihat FR9/§5.3). `payment_items` kosong untuk payment jenis
  ini adalah kondisi normal, bukan error.
- **Kompatibel mundur (NFR3):** payment lama tak punya baris `payment_items` →
  ditampilkan tanpa rincian item (sama seperti DP/equal). Tak perlu backfill.
- **Void item (Edge Cases §9):** `order_item_id` pakai `on delete restrict`; item
  yang sudah tertaut pembayaran tak boleh terhapus keras. Void = ubah status
  `order_items.status='void'`, baris `payment_items` tetap ada (histori jujur).

### 7.2 `addOrderItem` (`src/lib/actions.ts:1481-1565`)
- Cabang customer: ganti cek "joined member" → cek **host** (`session.host_id
  === profile.id`). Non-host ditolak (FR1).
- Tambah cek **outstanding > 0 → tolak** sebelum insert (FR4), reuse
  `getOutstandingMap([sessionId])`.
- Cabang staff (`onBehalfOfMemberId`): tidak diubah untuk host-only; untuk
  pay-before-order lihat FR7/Q1.

### 7.3 UI Session (`SessionView.tsx`)
- Gate aksi order (MenuTab/keranjang `SessionView.tsx:1260-1291`) → host-or-staff
  saja; non-host read-only.
- Tombol tambah pesanan disabled + alasan bila `outstanding > 0`.
- Perluas daftar pembayaran jadi expandable (rincian item) — customer & staff.

### 7.4 Penulisan `payment_items` (saat payment dibuat)
- Pada action pembuatan payment **itemized** (jalur customer/host `payShare` dan
  — bila relevan — kasir): setelah insert `payments`, insert baris
  `payment_items` untuk tiap item yang dibayar (dari `order_items` milik member),
  dalam transaksi yang sama. DP/equal/custom **tidak** menulis (FR8/Q2B).
- Bila PRD host-only membuat payment `itemized` per-anggota (split my-order),
  penulisan `payment_items` mengikuti item milik anggota tsb (§12 poin 4).

### 7.5 Staff & Admin
- `getSessionDetailForCashier` + `CashierPaymentPanel`: join `payment_items`,
  tampilkan rincian item per payment itemized + tombol Show QR untuk pending
  (kasir & waiter).
- `getTransactionDetail` + `/admin/transactions/[id]`: join `payment_items`,
  tampilkan item yang dicakup payment itemized (per-transaksi, Q4 default).

---

## 8. Alur Pengguna

### 8.1 Host tambah order (normal)
1. Host buka menu → tambah item → kirim.
2. Server cek: caller = host ✅, `outstanding == 0` ✅ → item masuk.

### 8.2 Host tambah order saat masih ada sisa
1. Host coba tambah item.
2. Server cek `outstanding > 0` → tolak: "Lunasi dulu sisa Rp X."
3. Host bayar (jalur pembayaran host) → outstanding 0 → boleh tambah lagi.

### 8.3 Anggota non-host coba tambah order
1. Menu read-only / tombol nonaktif.
2. Bila memaksa call server → ditolak "Hanya host yang bisa menambah pesanan."

### 8.4 Lihat Riwayat Order-Payment
- Customer/host: buka tab pembayaran → klik satu pembayaran → lihat item yang
  dicakup + nominal.
- Kasir/waiter: buka sesi → panel pembayaran → expand pembayaran.
- Admin: `/admin/transactions/[id]` → payment → item.

---

## 9. Edge Cases
- **Order pertama saat open (DP)** → lewat `openTable`, bukan `addOrderItem`;
  tidak terkena gate pay-before-order. Gate hanya penambahan berikutnya.
- **Sesi walk-in (no host — lihat PRD terkait)** → tak ada host customer; **staff**
  yang menambah order (cabang staff), tidak terkena host-only. (§12.)
- **Bill lunas lalu host mau nambah** → outstanding 0 → boleh (sesuai FR4).
- **Item di-void setelah dibayar** → baris `payment_items` tetap ada
  (`on delete restrict`); item status jadi `void` tapi rincian histori tetap
  tampil jujur (§7.1).
- **Payment expired/failed** → tak dihitung paid; outstanding tetap; tak
  menautkan item aktif.
- **DP / equal / treat di riwayat** → tampil **label + nominal saja**, tanpa
  daftar item (Q2B). Hanya `itemized` yang punya rincian item.

---

## 10. Kriteria Penerimaan
1. Anggota non-host tak bisa menambah order (UI nonaktif + server tolak).
2. Host bisa menambah order hanya jika `outstanding == 0`; bila ada sisa,
   ditolak dgn pesan nominal yang benar.
3. Order pertama saat open (DP flow) tetap berhasil (tak terkena gate).
4. Staff tetap bisa input order atas nama meja.
5. Pembayaran `itemized` di riwayat bisa di-expand menampilkan item yang dicakup
   + nominal (dari `payment_items`), di sisi customer, kasir, waiter, dan admin.
   DP/equal/treat tampil label + nominal saja.
6. Payment `pending` (belum expired) menampilkan tombol Show QR di sisi customer
   (pemilik) & staff (kasir/waiter).
7. Admin dapat melihat riwayat order-payment per transaksi (`getTransactionDetail`).
8. Split yang masih `pending` **tidak** membuka gate pay-before-order (hanya
   `paid` yang mengurangi outstanding).
9. Tidak ada regresi: DP, split (PRD terkait), pembayaran kasir, callback/polling.

---

## 10a. Adendum (revisi setelah review UI — 2026-07-12)

Perubahan yang diminta setelah PRD awal, sudah diimplementasi:

1. **Semua pesan user-facing English.** Banner pay-before-order + toast split/cancel
   diubah dari Bahasa Indonesia ke English (server error message sudah English).
2. **Tax & service dibebankan PER ORDER (bukan hanya display).** Pada split
   `itemized`, `payment.amount = subtotal item bagian itu + tax + service atas
   subtotal itu` (`computeBillTotals(itemSubtotal, charge).total`). `equal` sudah
   `total/N` (termasuk tax). `payment_items.amount` tetap menyimpan **subtotal
   item** (tanpa tax); tax per transaksi = `payment.amount − Σ payment_items.amount`,
   ditampilkan sebagai baris terpisah di halaman detail. Konsekuensi pembulatan:
   tax dihitung per-bagian, jadi Σ bisa berbeda ±1–2 dari tax total meja — dapat
   diterima (tiap transaksi konsisten dengan dirinya sendiri).
3. **Halaman Bill = list per-transaksi (bukan grup per-member).** Tab Bill kini:
   ringkasan tagihan (subtotal/tax/total) + **daftar transaksi** (tiap `payments`
   row) dengan tipe, pembayar, metode, waktu, nominal, status. Tiap baris link ke
   halaman detail. (Referensi UI: SS-1.)
4. **Halaman detail transaksi** `/session/[id]/tx/[paymentId]` (route baru):
   status + ID (copy) + detail (pembayar/tipe/metode) + **list item** + subtotal +
   **tax & service** + total + **QRIS** (render inline + countdown + auto-poll
   status). QR hanya tampil ke **pemilik payment atau staff** (member lain lihat
   detail read-only tanpa QR). Action baru: `getSessionPaymentDetail`. (Referensi
   UI: SS-2 struk Duitku.)
5. **Admin/staff tambah order: tombol "Pay" (bukan "Save order").** Setelah item
   tersimpan, staff diarahkan ke tab **Pay** untuk memilih metode → generate QRIS.
   (Customer/host tetap "Save order".) `StaffMenuGrid` dapat prop `saveLabel`.

---

## 11. Keputusan (terkonfirmasi)
- **Q1 — Pay-before-order untuk staff?** → **Dikecualikan.** Gate hanya untuk
  jalur customer/host; staff atas nama meja tetap bisa nambah order. (FR7.)
- **Q2A — Model penautan payment↔item?** → **Tabel baru `payment_items`**
  (ternormalisasi). (§7.1.)
- **Q2B — Tampilan payment non-item (DP/equal/treat)?** → **Hanya label +
  nominal**, tanpa daftar item, tanpa alokasi proporsional. Hanya `itemized`
  yang rinci per-item. (FR9.)
- **Q3 — "Tiap staff bisa list history".** → **Read-only per-sesi**, tanpa
  atribusi per-staff (`processed_by_id` tak ditambah). **Tambahan:** untuk
  payment yang masih `pending`, staff dapat **menampilkan QRIS-nya** (Show QR)
  untuk bantu tamu bayar. (FR9a, FR12.)
- **Q4 — Cakupan admin.** → **Default per-transaksi** (`getTransactionDetail` +
  rincian item). Tidak membangun ledger per-meja lintas sesi (di luar scope).

---

## 12. Interaksi dengan PRD Host-Only Payment & QRIS Split
Kedua PRD menyentuh **gate host** dan **`addOrderItem`**/pembayaran yang sama.
Titik singgung yang harus disinkronkan:

1. **Definisi host & sesi walk-in.** PRD host-only menetapkan: sesi walk-in
   **tidak punya host** → staff yang urus pembayaran. Dokumen ini konsisten:
   pada walk-in, **staff** yang menambah order & mengurus bayar; gate host-only
   order **tidak** berlaku (cabang staff).
2. **Gate host di dua tempat.** PRD host-only → host-only untuk **membuat
   pembayaran/QRIS**. PRD ini → host-only untuk **menambah order**. Keduanya
   berbagi pola "cek `host_id === profile.id` di cabang customer, staff
   dikecualikan". Sebaiknya diimplementasi dengan **helper otorisasi bersama**
   (mis. `assertHostOrStaff(sessionId, profile)`), agar aturan konsisten & tak
   dobel-logika.
3. **Outstanding sebagai sumber tunggal.** Pay-before-order (PRD ini) dan
   perhitungan share split (PRD host-only) sama-sama bergantung pada
   `outstanding`/`remaining`. Gunakan sumber perhitungan yang sama
   (`getOutstandingMap`/`computeBillTotals`) di kedua PRD.
4. **Riwayat.** Penautan payment↔item (PRD ini) memperkaya "Payments received"
   yang juga dipakai PRD host-only (split per anggota). Payment hasil split
   (`equal`/`itemized`) harus ikut pola tampilan rincian item di §5.3.
5. **Urutan eksekusi disarankan:** finalisasi **PRD ini** dulu (host-only order +
   gate + helper otorisasi bersama), lalu **update PRD host-only payment** agar:
   - mengacu ke helper otorisasi bersama yang sama,
   - payment split ikut model penautan item (§7.1),
   - definisi walk-in/no-host konsisten.
   *(Update PRD host-only dilakukan setelah PRD ini disetujui — sesuai instruksi user.)*
