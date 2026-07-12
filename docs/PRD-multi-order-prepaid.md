# PRD — Multi-Order per Meja + Prepaid (Bayar Dulu Baru Masuk)

**Status:** ✅ Confirmed — semua keputusan (Q1–Q7) terjawab (§12). Siap eksekusi.
**Penulis:** Safki Fajar
**Tanggal:** 2026-07-12
**Area:** Orders (fondasi) · Session Bill/Order UX · Payment · Kasir/Waiter/Admin/Dapur
**Terkait / merevisi sebagian:**
[PRD Bill-Centric Payment](PRD-bill-centric-payment-rework.md) ·
[PRD Host-Only Order Control](PRD-host-order-control-payment-history.md) ·
[PRD Host-Only Payment & QRIS Split](PRD-host-only-payment-split-qris.md)

> ⚠️ Ini perubahan **fondasi**. Model berubah dari **1 meja = 1 order** menjadi
> **1 meja = banyak order**, dan tiap order **prepaid** (dibayar dulu baru
> "masuk" ke dapur/staff). Sebagian UX Bill-centric yang baru dibangun direvisi.

---

## 1. Ringkasan

- **Multi-order per meja.** Tiap sesi pemesanan = **order terpisah**. Order
  pertama dibuat saat open table; tiap penambahan pesanan berikutnya = **order
  baru**.
- **Prepaid ("bayar dulu baru masuk").** Order baru berstatus **unpaid** dan
  **TIDAK terlihat** oleh kasir/waiter/dapur sampai dibayar lunas. Setelah lunas
  → order "masuk" (submitted) dan baru muncul di sisi staff + antrian dapur.
- **Order pertama ikut pengaturan admin.** Kalau bar mewajibkan DP → bayar DP
  dulu; kalau wajib full → bayar penuh; kalau tidak wajib → order langsung masuk
  (bayar belakangan). Reuse `reservationConfig.minDownPaymentPercent`.
- **Tab Bill = list order.** Tiap baris = 1 order (id, nominal, tanggal, jumlah
  item, status). Klik → **halaman detail order** `/session/[id]/order/[orderId]`:
  info order + item + history payment + tombol **Bayar** (form + QRIS inline).
- **Status per-order.** Order punya status eksplisit (`unpaid → paid → closed`)
  + `paid_at`.

---

## 2. Latar Belakang & Konflik (as-is)

Model sekarang: **order = singleton per sesi**, dibuat sekali saat open table,
dipakai ulang selamanya. Semua lookup "the order" berasumsi 1 baris. Bill &
outstanding dihitung **level-sesi** (gabung semua order). Tak ada konsep
paid/unpaid per-order.

### 2.1 Konflik utama (dari pemetaan kode) — harus ditangani
1. **Kunci unik `uq_open_order_per_session`** (`db/schema/orders.ts:40-42`,
   `WHERE status <> 'closed'`) — **melarang** >1 order aktif per sesi. **Wajib
   diubah/dihapus dulu** sebelum apa pun bisa jalan.
2. **`addOrderItem`** (`actions.ts:1548-1584`) menambah ke "order terbuka" satu-
   satunya + gate pay-before-order level-sesi. → jadi **buat order baru** per
   sesi pemesanan.
3. **`getOutstandingMap`** (`queries.ts:240-296`) menghitung outstanding
   **per-sesi** (GROUP BY sessionId). → butuh **per-order**.
4. **Pembayaran menempel ke "order terbuka"**: `payShare` (`actions.ts:1762`,
   ada fallback "latest order" yg rusak kalau banyak order), `createSplitBatch`
   (`:1914`), DP (`:501`). → harus target **orderId spesifik**.
5. **View detail load 1 order** (LIMIT 1): kasir `getSessionDetailForCashier`
   (latest), admin `getSessionDetail` (first), customer `page.tsx:163`. → harus
   **loop semua order**.
6. **Tak ada status "paid" di order** — `orderStatusEnum` cuma dipakai
   `open`/`closed`. → butuh status per-order baru.

### 2.2 Yang sudah aman (tak berubah untuk korektksi)
- Dapur/antrian & status item (`order_items.status`: sent/preparing/served) —
  level item, tak peduli jumlah order. Justru cocok: item "masuk dapur" hanya
  setelah order-nya paid.
- Agregat list (waiter cards, cashier list, shift report) — GROUP BY sessionId,
  tetap jalan (tapi UX perlu tampilkan per-order status).
- Mutasi payment by paymentId (mark-paid/cancel) — order-count-agnostic.
- Close-all-orders (`cashierCloseSession`, `closeTable`) — update by sessionId.

---

## 3. Tujuan & Non-Tujuan

### 3.1 Tujuan
- **G1** — Izinkan **banyak order aktif** per sesi (ubah kunci DB).
- **G2** — Tiap penambahan pesanan = **order baru** (bukan append).
- **G3** — Order **prepaid**: unpaid → sembunyi dari staff/dapur; paid → masuk.
- **G4** — Order pertama ikut **setting bar** (DP/full/none).
- **G5** — **Status & outstanding per-order** (kolom status + paid_at).
- **G6** — Tab **Bill = list order**; halaman **detail order** dgn item +
  history payment + tombol bayar (form + QRIS inline).
- **G7** — Kasir/waiter/admin/dapur menampilkan **per-order** (yang sudah paid),
  konsisten.
- **G8** — Reuse pekerjaan yang ada: `/tx/[paymentId]`, `PaymentSheet`,
  `payment_items`, host-only gates, tax-per-order.

### 3.2 Non-Tujuan
- Tidak mengubah gateway/metode bayar.
- Tidak mengubah aturan host-only (bayar & order) — hanya jadi **per-order**.
- Tidak mengubah alur DP booking reservasi (tetap ada), hanya diselaraskan.
- Tidak menambah refund.

---

## 4. Model Data Baru

```
SESI (table_sessions)
 └── ORDER #1 (open table)      status: unpaid|paid|closed, paid_at
 │     ├── items (order_items)
 │     └── payments (DP / split / dst)
 └── ORDER #2 (tambahan)        status: unpaid → (bayar) → paid → masuk dapur
 │     ├── items
 │     └── payments
 └── ORDER #3 ...
```

### 4.1 Perubahan schema (`orders`)
- **Hapus/ubah** `uq_open_order_per_session`. Ganti dgn: tak ada batasan jumlah
  order (atau unik hanya utk 1 order `unpaid`-draft yg sedang disusun — §12 Q1).
- **`orderStatusEnum`**: perjelas lifecycle. Usulan nilai:
  `unpaid` (baru, belum bayar) → `paid` (lunas, masuk dapur) → `closed`.
  *(Nilai lama `submitted/preparing/served` tak dipakai di level order — bisa
  di-drop atau dibiarkan. §12 Q2.)*
- **`orders.paid_at`** timestamptz — kapan order lunas & "masuk".
- **`orders.submitted_at`** (opsional) — kapan order dikirim ke dapur (= paid_at
  utk prepaid).

### 4.2 Prinsip
- Order **`unpaid`** = keranjang yang sudah dikonfirmasi customer, menunggu bayar.
  Item-nya **tidak** tampil di dapur/kasir/waiter.
- Order jadi **`paid`** saat total order lunas (callback/mock) → item masuk dapur
  (status item → `sent`), muncul di semua view staff.
- **Outstanding per-order** = total order − Σ(payment lunas order itu).
- **Bill sesi** = agregat semua order (utk ringkasan meja), tetap ada.

---

## 5. Persyaratan Fungsional

### 5.1 Pembuatan order (multi-order)
- **FR1.** Ubah kunci DB agar >1 order aktif per sesi diizinkan, **tetapi maks 1
  order `unpaid`** per sesi (Q1). Sebelum buat order baru: kalau ada order
  `unpaid` → tolak ("Lunasi order sebelumnya dulu").
- **FR2.** **Order pertama** (open table): dibuat saat open. Ikut setting bar:
  - `minDownPaymentPercent > 0` & wajib DP → order `unpaid`, bayar DP dulu →
    `paid` saat DP lunas (sesuai perilaku DP sekarang).
  - Wajib full (setting) → order `unpaid`, bayar penuh dulu.
  - Tidak wajib → order boleh langsung `paid`/masuk (bayar belakangan, mis. bayar
    di akhir seperti sekarang). *(§12 Q3 — definisi "tidak wajib".)*
- **FR3.** **Tambah pesanan** (customer/host, saat sesi berjalan): buat **order
  baru** `unpaid` berisi item yang dipilih. Order ini **belum** masuk dapur.
- **FR4.** Order `unpaid` harus **dibayar** (DP/full sesuai tipe) → jadi `paid` →
  item masuk dapur (status `sent`) + muncul di staff.
- **FR5.** `addOrderItem` lama (append ke order) diganti: aksi "Save/Pay" di menu
  → buat 1 order baru dari cart. (Host-only tetap; staff atas nama meja tetap.)

### 5.2 Prepaid — sembunyikan unpaid dari staff/dapur
- **FR6.** Semua view **kasir/waiter/dapur** hanya menampilkan order berstatus
  **`paid`/`closed`** (bukan `unpaid`). Order unpaid tak masuk antrian dapur,
  tak muncul di dashboard kasir/waiter.
- **FR7.** Saat order jadi `paid` (pembayaran lunas via callback/mock), item-nya
  di-set `sent` (masuk antrian) + notifikasi staff/dapur.
- **FR8.** Admin **boleh** melihat order unpaid (audit) — atau tidak, §12 Q4.

### 5.3 Status & outstanding per-order
- **FR9.** Tambah `orders.status` (unpaid/paid/closed) + `paid_at`.
- **FR10.** Outstanding dihitung **per-order** (fungsi baru
  `getOrderOutstanding(orderId)` atau perluasan `getOutstandingMap` ke level
  order). Order `paid` = outstanding 0.
- **FR11.** Bill/summary sesi tetap tersedia (agregat) utk header meja.

### 5.4 Tab Bill = list order
- **FR12.** Tab Bill menampilkan **list order** sesi ini. Tiap baris:
  **ID order** (ringkas), **nominal** order (total), **tanggal/waktu**, **jumlah
  item**, **status** (Unpaid/Paid/Closed). Urут terbaru dulu.
- **FR13.** Klik baris order → **halaman detail order**
  `/session/[id]/order/[orderId]`.

### 5.5 Halaman detail order
- **FR14.** Route baru `/session/[id]/order/[orderId]` menampilkan:
  - **Info order** (id, tanggal, status, total).
  - **List item** order (nama, qty, harga) + subtotal + tax & service.
  - **History payment** order ini (tiap pembayaran + status). Kalau ada **DP**,
    tampilkan **nominal DP** di history.
  - **Tombol Bayar** (bila order belum lunas; host/staff).
- **FR15.** Tombol **Bayar** → **form pembayaran inline** (pilih tipe: split/my-
  order/treat + metode) → generate → **QRIS tampil inline** di halaman detail
  order. History payment update dgn status.
- **FR16.** Payment `pending` di history → tombol **"Show QR"** (tampilkan QRIS
  lagi). Reuse pola QR yang ada.
- **FR17.** Semua pembayaran (payShare/split/DP) **target orderId spesifik**
  (order di halaman ini), bukan "order terbuka sesi".

### 5.6 Konsistensi lintas peran
- **FR18. Kasir.** `getSessionDetailForCashier` **loop semua order paid** →
  tampilkan per-order (sub-bill). Aksi accept/mark-paid/close tetap.
- **FR19. Waiter.** Session card tunjukkan status per-order (berapa order paid /
  menunggu). Antrian dapur hanya item dari order paid.
- **FR20. Admin.** `getTransactionDetail`/`getSessionDetail` loop semua order
  (termasuk `unpaid`, ditandai — Q4).

### 5.7 Close table (Q6)
- **FR21.** **Customer/host TIDAK bisa menutup meja** bila masih ada order belum
  lunas (`unpaid` atau order `paid`-sebagian dgn sisa > 0). Tombol close
  disabled + pesan "Selesaikan semua pembayaran dulu".
- **FR22.** **Staff kasir** tetap bisa force-close; saat close, order `unpaid`
  **di-void** (tak ditagih). Order `paid` yg masih ada sisa → sesi jadi
  `overdue` (perilaku sekarang).

---

## 6. Non-Fungsional
- **NFR1.** Migrasi schema aman (backfill order lama → status `paid`/`closed`
  sesuai keadaan; sesi berjalan lama tetap valid).
- **NFR2.** Otorisasi server tetap (host-only per-order, qr filter).
- **NFR3.** Prepaid hook idempotent (callback lunas → set order paid sekali).
- **NFR4.** Kompat mundur: sesi/ order lama (1 order) tetap render benar sbg list
  berisi 1 order.

---

## 7. Perubahan Teknis (High-Level)

### 7.1 Schema (migrasi — `drizzle-kit push`)
- Drop `uq_open_order_per_session`; (opsional) unik utk max 1 order `unpaid`
  per sesi (§12 Q1).
- `orderStatusEnum` → tambah `unpaid`, `paid` (atau redefinisi lifecycle).
- `orders.paid_at`, (opsional) `orders.submitted_at`.
- Backfill: order existing non-closed → `paid` (anggap sudah masuk).

### 7.2 Order creation & item flow
- `openTable`: order pertama status sesuai setting (unpaid kalau wajib bayar).
- Ganti `addOrderItem`-append → **`createOrder(items[])`** (buat order baru
  unpaid dari cart). Host-only + staff-on-behalf dipertahankan.
- Saat order lunas (callback/mock) → set `orders.status='paid'`, `paid_at`,
  item→`sent`, notify staff/dapur.

### 7.3 Outstanding & payment per-order
- `getOrderOutstanding(orderId)` + versi map. Konsumen (payShare, split, gate)
  pindah ke per-order.
- `payShare`/`createSplitBatch`/DP terima **orderId** eksplisit.

### 7.4 Views
- Kasir/admin: loop orders (bukan LIMIT 1). Waiter/dapur: filter `status='paid'`.
- customer `page.tsx`: ambil **semua** order sesi utk list Bill.

### 7.5 UI
- **Bill** (revisi): dari "1 kartu order" → **list order** (reuse pola list).
- **Halaman detail order** baru `/session/[id]/order/[orderId]` — reuse
  `PaymentSheet` (form) + render QRIS inline (reuse logika `/tx`
  `TransactionDetailView`).
- **`/tx/[paymentId]`** tetap ada sbg detail per-transaksi (dibuka dari history
  payment), atau digabung — §12 Q5.

---

## 8. Alur Pengguna

### 8.1 Open table (order pertama)
1. Pilih menu → lanjutkan. Order #1 dibuat.
2. Setting bar: wajib DP → bayar DP → order #1 `paid` (masuk). Wajib full →
   bayar penuh. Tak wajib → langsung masuk.

### 8.2 Tambah pesanan (order baru)
1. Host buka Menu → pilih item → "Pesan/Bayar".
2. Order #2 `unpaid` dibuat (belum masuk dapur).
3. Buka Bill → list order: Order #2 [Unpaid]. Klik → detail order.
4. Tombol Bayar → form (tipe+metode) → QRIS inline → bayar.
5. Lunas → Order #2 `paid` → item masuk dapur, muncul di kasir/waiter.

### 8.3 Kasir/waiter
- Hanya lihat order `paid`. Bill meja = agregat order paid. Close = tutup semua.

---

## 9. Edge Cases
- **Order unpaid dibatalkan / expired** (QR habis) → order tetap `unpaid`; host
  bisa bayar ulang atau batalkan order (hapus/void). §12 Q6.
- **Beberapa order unpaid sekaligus** → tiap order bayar sendiri; tak ada
  "fallback latest order" lagi.
- **Sesi walk-in (no host)** → staff yang buat & bayarkan order.
- **DP order pertama** → order pertama `unpaid` sampai DP lunas; sisa dibayar di
  akhir (order tetap `paid` setelah DP? atau `paid` hanya setelah lunas penuh?).
  §12 Q7 — definisi "masuk" utk order DP-sebagian.
- **Close table dgn order unpaid menggantung** → order unpaid diabaikan/di-void
  saat close (tak ditagih). §12 Q6.

---

## 10. Kriteria Penerimaan
1. Bisa ada >1 order aktif per meja (kunci DB diubah).
2. Tambah pesanan → order baru `unpaid`; item **tidak** muncul di dapur/kasir/
   waiter sampai order dibayar.
3. Order lunas → `paid` + `paid_at`; item masuk antrian dapur + muncul di staff.
4. Order pertama ikut setting bar (DP/full/none).
5. Tab Bill = list order (id, nominal, tanggal, jumlah item, status).
6. Klik order → halaman detail: info + item + history payment (DP tampil) +
   tombol Bayar.
7. Tombol Bayar → form → QRIS inline; history update; pending → Show QR.
8. Pembayaran target orderId spesifik (bukan order terbuka sesi).
9. Kasir/waiter/admin tampilkan per-order konsisten.
10. Tak ada regresi: host-only, tax-per-order, split/cancel, DP booking, close.

---

## 11. Dampak ke pekerjaan sebelumnya (yang perlu direvisi)
- **Tab Bill** (Bill-centric): dari "1 kartu order + tombol Pay + riwayat" →
  **list order**. Tombol Pay pindah ke halaman detail order.
- **Halaman `/tx/[paymentId]`**: tetap dipakai (detail transaksi) tapi pembayaran
  BARU dilakukan di halaman **detail order**, bukan redirect ke /tx.
- **`payShare`/`createSplitBatch`/pay-before-order**: dari level-sesi → **level-
  order** (target orderId).
- **CashierPaymentPanel di Bill**: perlu tampilkan per-order (bukan 1 order).

---

## 12. Keputusan (terkonfirmasi)
- **Q1 — Batasan order unpaid.** → **Maks 1 order `unpaid` per sesi.** Order
  unpaid harus **lunas dulu** baru bisa buat order baru. Enforce: unique index
  `WHERE status = 'unpaid'` per sesi + cek di server sebelum buat order baru
  ("Lunasi order sebelumnya dulu").
- **Q2 — Nilai `orderStatusEnum`.** → **`unpaid / paid / closed`** saja. **Tak
  ada status masak di order** — status masak tetap di `order_items`
  (sent/preparing/served).
- **Q3 — Order pertama tak wajib bayar.** → **Ya**, langsung `paid`/masuk (bayar
  di akhir) seperti perilaku sekarang, bila bar tak wajib DP/full.
- **Q4 — Admin lihat order unpaid.** → **Ya**, admin melihat order unpaid
  (ditandai). Kasir/waiter/dapur tetap tidak.
- **Q5 — Route `/tx/[paymentId]`.** → **Tetap** sebagai detail per-transaksi
  (dibuka dari history payment). Pembayaran BARU dilakukan di halaman detail
  order (inline).
- **Q6 — Order unpaid saat close / close table.** → Saat close table, order
  `unpaid` **di-void** (tak ditagih). **PLUS: customer/host TIDAK bisa menutup
  meja bila masih ada order belum lunas** (`unpaid` atau `paid`-sebagian yg masih
  ada sisa). Hanya boleh close kalau semua order beres. (Staff kasir tetap bisa
  force-close spt sekarang, meng-void unpaid.)
- **Q7 — Order pertama dgn DP: kapan "masuk".** → **Setelah DP lunas.** Order #1
  masuk dapur begitu DP lunas; sisa ditagih di akhir. (Konsisten perilaku DP
  sekarang.)
