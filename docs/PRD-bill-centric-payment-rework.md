# PRD — Bill-Centric Payment (Hapus Tab Pay, Bayar dari Bill)

**Status:** ✅ Confirmed — semua keputusan (Q1–Q6) terjawab (§11). Q4 akan direview
ulang saat implementasi. Siap eksekusi.
**Penulis:** Safki Fajar
**Tanggal:** 2026-07-12
**Area:** Session · Bill/Pay UX · Transaction detail · Waiter · Cashier
**Terkait:**
[PRD Host-Only Payment & QRIS Split](PRD-host-only-payment-split-qris.md) ·
[PRD Host-Only Order Control & Riwayat](PRD-host-order-control-payment-history.md)
(dokumen ini **merevisi** bagian UX pembayaran dari kedua PRD di atas)

---

## 1. Ringkasan

Menyatukan seluruh flow pembayaran ke dalam **tab Bill** dengan model konseptual
**"satu sesi = satu order"**:

- **Hapus tab Pay.** Tidak ada lagi tab pembayaran terpisah.
- **Tab Bill = satu order.** Menampilkan: **list menu** yang dipesan + **riwayat
  pembayaran** (termasuk DP bila ada) + **status order** (Lunas / Belum lunas)
  + tombol **"Pay"** bila belum lunas (host/staff).
- Tombol **Pay** → **bottom-sheet** pilih tipe (Split / My order / Treat) +
  metode → generate → **diarahkan ke halaman detail transaksi** yang menampilkan
  **QRIS** sesuai tipe.
- **Halaman detail transaksi** menampilkan: **list menu** yang dicakup + rincian
  (subtotal/tax/service) + **QRIS**. Untuk split: **ringkasan status semua
  anggota** + **QRIS host**; tiap anggota melihat QRIS-nya sendiri dari
  transaksinya masing-masing di Bill mereka.
- **Konsisten di semua peran**: customer, waiter, dan cashier memakai pola yang
  sama (Bill-centric), bukan komponen pembayaran terpisah.

---

## 2. Latar Belakang & Masalah (as-is)

### 2.1 Realita sekarang
- **4 tab**: `vibe (Table) · menu · bill · pay` (`SessionView.tsx:207`).
- **Tab Pay** merender:
  - `SplitPayment` (customer/waiter) — form pilih tipe+metode+generate +
    "Payments received" (`components/session/SplitPayment.tsx`), **atau**
  - `CashierPaymentPanel` (kasir) — panel berbeda dgn kalkulator kembalian,
    mark-paid, close→receipt (`components/cashier/CashierPaymentPanel.tsx`),
    dipilih via `cashierDetail` (`page.tsx:299-302`, `SessionView.tsx:451`).
- **Tab Bill** (baru diubah) merender: item grup per-member + ringkasan tagihan
  + **list "Transactions"** yang link ke `/session/[id]/tx/[paymentId]`
  (`SessionView.tsx:1511-1548`).
- **1 order per sesi** sudah dijamin DB: `uq_open_order_per_session`
  (`db/schema/orders.ts:40-42`). `openTable` bikin tepat 1 order.
- **DP** = 1 baris `payments` dgn `splitMeta.isDownPayment=true`, `splitMode
  'custom'`, status awal pending; saat lunas set `tableSessions.dpPaidAt`
  (`actions.ts:497-572`). DP juga punya halaman bayar sendiri
  `/booking/[id]/pay` (`BookingPayView` → `QrisPaymentDialog`, timeout 60 detik).
- **Status lunas/pending** tidak ada kolom eksplisit — **dihitung** via
  `getOutstandingMap`/`remaining` = `total − Σ(payments paid)` (`queries.ts:240`).
- **Halaman detail transaksi** `/session/[id]/tx/[paymentId]` sudah ada
  (status + item + tax + QRIS), action `getSessionPaymentDetail`.

### 2.2 Masalah
1. **Pembayaran tersebar** di tab Pay yang terpisah dari Bill; user harus pindah
   tab untuk melihat pesanan vs membayar.
2. **Tiga UI pembayaran berbeda** (SplitPayment / CashierPaymentPanel / list
   Transactions baru) → **tidak konsisten** & ada **duplikasi riwayat**
   ("Payments received" di SplitPayment vs "Transactions" di BillTab).
3. Model mental "1 order dengan status + riwayat + tombol bayar" belum
   tercermin di UI (Bill sekarang campur item-per-member + tx list).

---

## 3. Tujuan & Non-Tujuan

### 3.1 Tujuan
- **G1** — Hapus tab **Pay** sepenuhnya (UI + gating + swipe + fallback).
- **G2** — Tab **Bill** jadi tampilan **satu order**: list menu + status order +
  riwayat pembayaran + tombol **Pay** (host/staff bila belum lunas).
- **G3** — Tombol Pay → bottom-sheet (tipe+metode) → generate → **redirect ke
  halaman detail transaksi** dgn QRIS sesuai tipe.
- **G4** — Halaman detail transaksi menampilkan **item yang dipesan/dicakup** +
  QRIS; untuk split → ringkasan status semua anggota + QRIS host.
- **G5** — **Konsisten lintas peran** (customer/waiter/cashier). Hilangkan
  duplikasi riwayat pembayaran (satu sumber tampilan).
- **G6** — Tidak merusak: DP flow, callback/polling, host-only gates,
  pay-before-order, tax-per-order, close table.

### 3.2 Non-Tujuan
- Tidak mengubah skema pembayaran/`payment_items`/gateway.
- Tidak mengubah aturan host-only (bayar & order) & pay-before-order — hanya
  **memindahkan tempat** tombol/aksinya.
- Tidak menambah kolom `orders.status='paid'` (status tetap dihitung), **kecuali**
  §11 Q4 memutuskan sebaliknya.
- Tidak mengubah alur DP booking `/booking/[id]/pay` (tetap sebagai entry DP
  saat reservasi) — hanya memastikan konsisten ditampilkan di Bill.

---

## 4. Model Konseptual "Satu Order"

```
SESI (table_sessions)
 └── ORDER (orders, 1 aktif per sesi)
      ├── ITEMS (order_items)              → "list menu" di Bill
      ├── STATUS: Lunas | Belum lunas      → dihitung: remaining==0 ?
      └── PAYMENTS (payments)              → "riwayat pembayaran" di Bill
           ├── DP (isDownPayment)          → baris "DP"
           ├── Split/My-order/Treat        → tiap transaksi 1 baris
           └── (klik) → halaman detail transaksi + QRIS
```

- **Bill menampilkan 1 kartu order** (bukan grup per-member seperti sekarang,
  kecuali §11 Q1 memutuskan tetap dikelompokkan). Isi kartu: daftar item, total,
  status, riwayat pembayaran, tombol Pay.
- **DP** = pembayaran pertama dalam riwayat; order tetap "Belum lunas" selama
  `remaining > 0`.

---

## 5. Persyaratan Fungsional

### 5.1 Hapus tab Pay
- **FR1.** Hilangkan tab `pay`: dari `TAB_ORDER`, tombol tab, `showPayTab`,
  swipe skip (`showPayRef`), dan `effTab` fallback (`pay→bill`). Tab jadi:
  **Table · Menu · Bill**.
- **FR2.** `MenuTab.onSaved` (staff) yang tadinya `changeTab("pay")` → arahkan
  ke **`bill`**.
- **FR3.** Semua entry yang menuju tab pay (deep-link `?tab=pay`, dsb) → redirect
  ke `bill`.

### 5.2 Tab Bill = satu order
- **FR4.** Bill menampilkan **kartu order** berisi:
  - **List menu** (item + qty + harga + status masak). (Grup per-member: §11 Q1.)
  - **Ringkasan**: subtotal + tax & service + total.
  - **Status order**: badge **"Paid"** (remaining==0) atau **"Unpaid /
    Pending"** (remaining>0). Bila ada DP terbayar → tunjukkan "Paid (incl. DP)".
  - **Riwayat pembayaran** (satu-satunya, gantikan "Payments received" di
    SplitPayment & list Transactions lama): tiap baris = transaksi (DP/split/
    my-order/treat), status, nominal, waktu, **link ke halaman detail**.
  - **Tombol "Pay"** (host/staff, bila `remaining>0`) — lihat 5.3.
- **FR5.** Non-host member: kartu order **read-only** (lihat item + status +
  riwayat), **tanpa** tombol Pay (host-only, konsisten PRD sebelumnya). Tapi
  member tetap bisa **buka detail transaksinya sendiri** utk lihat QRIS-nya.
- **FR6.** Item removal (staff-only, sudah ada) tetap di kartu order Bill.

### 5.3 Tombol Pay → sheet → detail transaksi
- **FR7.** Klik **Pay** → **bottom-sheet** pilih:
  - **Tipe**: Split equally / My order / Treat (host); staff (payFullOnly) →
    terkunci "Pay in full". (Reuse picker dari SplitPayment.)
  - **Metode**: QRIS (only, sekarang).
- **FR8.** Setelah pilih & generate:
  - **Single** (treat/custom/staff) → buat 1 payment → **redirect ke
    `/session/[id]/tx/[paymentId]`** (halaman detail + QRIS).
  - **Split/My-order (batch)** → buat N payment (`createSplitBatch`) → **redirect
    ke halaman detail transaksi milik host** (QRIS host + ringkasan semua
    anggota). (§11 Q2: halaman detail per-batch vs per-payment.)
- **FR9.** Aturan host-only, pay-before-order, tax-per-order **tetap berlaku**
  (tidak berubah; hanya lokasi tombol pindah).

### 5.4 Halaman detail transaksi (perluasan)
- **FR10.** Halaman `/session/[id]/tx/[paymentId]` (sudah ada) diperluas, **list
  menu sesuai tipe (Q3)**:
  - **My order (itemized)** → item miliknya (dari `payment_items`).
  - **Treat (custom)** → **semua item meja** (tulis `payment_items` utk semua
    item, §11.1) + subtotal + tax + total.
  - **Split equally & DP** → **tanpa daftar item**, hanya label + nominal.
  - Rincian subtotal + tax & service + total (sudah ada, utk yg ber-item).
  - **QRIS** sesuai tipe (sudah render; pastikan tampil utk pending + pemilik/
    staff).
- **FR11. Split → ringkasan semua anggota + QR host.** Bila transaksi bagian dari
  batch split, halaman detail (host) menampilkan **daftar status anggota**
  (nama + nominal + Paid/Pending) + **QRIS host**. Anggota lain melihat QRIS
  sendiri dari halaman detail transaksinya masing-masing (via Bill mereka).
- **FR12. "Gratis"/Treat.** Bila host pilih Treat (bayar penuh), detail
  menampilkan 1 QRIS penuh; anggota lain tak perlu bayar (status order jadi lunas
  setelah dibayar).

### 5.5 Konsistensi lintas peran
- **FR13. Waiter.** Waiter memakai `SessionView` yg sama → otomatis ikut model
  Bill-centric (tombol Pay terkunci "Pay in full"). Tak ada UI waiter terpisah.
- **FR14. Cashier (relokasi penuh — Q5=A).** `CashierPaymentPanel` (kalkulator
  kembalian, mark-paid manual, cancel, close→receipt) **dipindahkan/diintegrasikan
  ke tab Bill**, konsisten dgn customer/waiter. Kasir melihat kartu order + status
  + riwayat pembayaran yang sama, dengan aksi kasir tambahan (accept payment via
  cash/QRIS, mark-paid, cancel, close→receipt) tersedia di Bill. Fitur kasir
  **tidak boleh hilang**. Tab Pay tak lagi jadi tempat panel kasir.

---

## 6. Non-Fungsional
- **NFR1.** Satu sumber tampilan riwayat pembayaran (hapus duplikasi 3-list).
- **NFR2.** Otorisasi tetap server-side (host-only Pay, qr_string filter).
- **NFR3.** Kompat mundur: sesi lama (dengan/atau tanpa DP, payment lama) tetap
  render benar di Bill.
- **NFR4.** Tak ada regresi realtime (SSE refresh saat pembayaran masuk).

---

## 7. Perubahan Teknis (High-Level)

### 7.1 SessionView (tab machinery)
- Hapus `pay` dari `Tab`/`TAB_ORDER`; hapus tombol tab Pay; hapus `showPayTab`,
  `showPayRef`, swipe-skip pay; sederhanakan `effTab` (fallback menu→bill).
- `MenuTab.onSaved` → `changeTab("bill")`.

### 7.2 BillTab (jadi kartu order + pembayaran)
- Gabungkan: item order (existing) + status order + **satu** riwayat pembayaran
  (pindahkan dari SplitPayment "Payments received"; buang list "Transactions"
  duplikat) + tombol **Pay**.
- Tombol Pay membuka sheet (pindahkan picker tipe+metode dari SplitPayment).
- Setelah generate → `router.push('/session/[id]/tx/[paymentId]')`.

### 7.3 SplitPayment
- **Pecah**: pindahkan **picker tipe+metode+generate** ke sheet yang dipanggil
  Bill; pindahkan **riwayat** ke Bill. Komponen SplitPayment lama bisa
  dihapus/diringkas jadi hanya "PaymentSheet" (form pilih) — sisanya di Bill.
- Pertahankan logika `canPay`, `payFullOnly`, batch vs single, cancel batch.

### 7.4 Halaman detail transaksi
- Perluas `getSessionPaymentDetail` + `TransactionDetailView`:
  - tambah ringkasan anggota utk batch (join by `splitMeta.batchId`).
  - list menu sesuai tipe (Q3): itemized→item miliknya, treat→semua item,
    equal/DP→tanpa item.
- **Penulisan `payment_items` treat (§11.1):** saat `payShare` membuat payment
  `custom`/treat, tulis `payment_items` utk **semua** item non-void order.
- Pertahankan countdown + poll status.

### 7.5 Cashier (relokasi penuh — Q5=A)
- Refactor `CashierPaymentPanel` agar fungsinya (accept payment cash/QRIS,
  kalkulator kembalian, mark-paid, cancel, close→receipt) tersedia **di tab Bill**
  (bukan panel terpisah di tab Pay). Hapus percabangan `cashierDetail ?
  CashierPaymentPanel : SplitTab` di tab Pay (`SessionView.tsx:451`); pindahkan ke
  Bill. `getSessionDetailForCashier` tetap dipakai sebagai sumber data kasir.
- Kartu order + riwayat pembayaran di Bill dipakai bersama; aksi kasir muncul
  sebagai tambahan bila `staffRole==='cashier'`.

### 7.6 Cleanup
- Hapus/redirect `?tab=pay`. Hapus list "Transactions" duplikat di BillTab lama.

---

## 8. Alur Pengguna

### 8.1 Host bayar sisa setelah DP
1. Buka Bill → kartu order: list menu, status **"Unpaid — Rp X"**, riwayat: "DP
   — Paid".
2. Klik **Pay** → sheet: pilih **My order / Split / Treat** + QRIS → Generate.
3. Redirect ke **detail transaksi**: list menu bagiannya + tax + **QRIS**.
4. Bayar (scan) → status transaksi jadi Paid → order jadi Lunas (bila remaining 0).

### 8.2 Split
1. Host klik Pay → Split equally → Generate (N QRIS).
2. Redirect ke detail transaksi host: **QRIS host** + **ringkasan status semua
   anggota**.
3. Anggota lain buka Bill mereka → klik transaksinya → **QRIS mereka sendiri**.

### 8.3 Anggota non-host
- Bill read-only: lihat item + status + riwayat. Tak ada tombol Pay. Bisa buka
  detail transaksinya utk QRIS (bila host sudah split).

### 8.4 Waiter / Cashier
- Waiter: sama seperti host tapi "Pay in full".
- Cashier: kartu order + riwayat + aksi kasir (cash/mark-paid/close) — konsisten.

---

## 9. Edge Cases
- **Belum ada order/item** → Bill tampilkan empty state; tak ada tombol Pay.
- **DP masih pending** (belum bayar) → order "Unpaid"; DP muncul di riwayat
  sebagai Pending; entry `/booking/[id]/pay` tetap berlaku saat reservasi.
- **Order lunas** → status "Paid"; tombol Pay hilang; tetap bisa lihat riwayat &
  detail.
- **Split sebagian dibayar** → status order tetap "Unpaid" sampai remaining 0;
  ringkasan anggota tunjukkan siapa sudah/belum.
- **Sesi walk-in (no host)** → staff yang bayar (Pay in full), konsisten.
- **QR expired** → detail transaksi tunjukkan Cancelled; host bisa generate ulang
  dari Bill.

---

## 10. Kriteria Penerimaan
1. Tab **Pay hilang** total; tak ada jalan (swipe/deeplink) ke sana.
2. Tab **Bill** menampilkan 1 kartu order: item + status (Paid/Unpaid) + riwayat
   pembayaran + tombol Pay (host/staff bila unpaid).
3. Klik **Pay** → sheet pilih tipe+metode → generate → **redirect ke halaman
   detail transaksi** dgn QRIS sesuai tipe.
4. Halaman detail menampilkan **list menu** + tax + QRIS; split → ringkasan
   anggota + QR host.
5. **Satu** riwayat pembayaran (tak ada duplikasi antar komponen).
6. Non-host member: Bill read-only, tanpa Pay; bisa lihat QRIS sendiri.
7. Waiter & cashier **konsisten** dengan model ini; fitur kasir (cash/mark-paid/
   close) tetap berfungsi.
8. Tak ada regresi: DP, host-only, pay-before-order, tax-per-order, callback/
   polling, close table.

---

## 11. Keputusan (terkonfirmasi)
- **Q1 — Kartu order di Bill.** → **1 kartu order** (semua item jadi satu daftar,
  tiap item ditandai pemesannya). Bukan lagi grup per-member.
- **Q2 — Halaman detail untuk split.** → **Per-payment host** + ringkasan status
  anggota. Reuse route `/session/[id]/tx/[paymentId]`; tak ada halaman batch
  terpisah.
- **Q3 — Item di detail transaksi per tipe.** →
  - **My order (itemized)** → tampilkan **item miliknya** (dari `payment_items`).
  - **Treat (custom, bayar penuh)** → tampilkan **SEMUA item meja** (host bayar
    seluruh tagihan) + subtotal + tax + total.
  - **Split equally & DP** → **tanpa daftar item**, hanya label + nominal.
- **Q4 — Status order.** → **Tetap dihitung** (`remaining==0`), tanpa kolom baru.
  *(Akan direview ulang saat implementasi bila perlu penanda eksplisit.)*
- **Q5 — Cashier.** → **(A) Relokasi penuh ke Bill.** Fitur kasir (kalkulator
  kembalian, mark-paid manual, cancel, close→receipt) dipindahkan/diintegrasikan
  ke tab Bill agar konsisten dengan customer/waiter. `CashierPaymentPanel`
  di-refactor jadi bagian dari Bill (bukan panel terpisah di tab Pay yang
  dihapus). Tidak boleh ada fitur kasir yang hilang.
- **Q6 — Komponen `SplitPayment`.** → **Refactor**: pecah jadi `PaymentSheet`
  (form pilih tipe+metode) yang dipanggil dari Bill + pindahkan riwayat ke Bill.
  File lama dihapus/diringkas (bukan duplikasi).

### 11.1 Dampak Q3 pada model penautan item
- **Treat sekarang perlu menautkan SEMUA item order** ke payment-nya (agar detail
  bisa menampilkan semua item). Saat ini `payment_items` **hanya** ditulis utk
  `itemized`. **Perubahan:** saat membuat payment `custom`/treat, tulis
  `payment_items` untuk **semua** item non-void order (amount = subtotal item),
  supaya detail treat menampilkan seluruh item. `equal`/DP tetap **tidak**
  menulis `payment_items` (tanpa item). *(Revisi kecil dari PRD Order Control
  Q2B yang menyatakan hanya itemized menulis payment_items — treat kini ikut.)*
