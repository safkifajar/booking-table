# Rencana Implementasi — Host Payment + Order Control (Gabungan)

**Tanggal:** 2026-07-12
**Sumber:**
[PRD Order Control & Riwayat](PRD-host-order-control-payment-history.md) ·
[PRD Host-Only Payment & QRIS Split](PRD-host-only-payment-split-qris.md)
**Prinsip:** fondasi bersama dulu → fitur order → fitur payment → riwayat →
staff/admin. Tiap fase bisa di-commit & di-test terpisah.

---

## Ringkasan urutan (dependency-first)

```
Fase 0  Fondasi bersama      → helper auth host + tabel payment_items (migrasi)
Fase 1  Host-only order      → addOrderItem gate + UI (PRD order FR1-3)
Fase 2  Pay-before-order     → gate outstanding (PRD order FR4-7)
Fase 3  Host-only payment    → gate payShare + payload paid_by_member_id (PRD pay FR1-3, FR9a)
Fase 4  Split batch + QRIS   → createSplitBatch + payment_items (PRD pay FR4-8)
Fase 5  Visibilitas QR       → filter qr_string customer, expose staff (PRD pay FR9-11)
Fase 6  Cancel split batch   → cancelSplitBatch + batchId (PRD pay Q2)
Fase 7  Riwayat order-payment→ expandable item + Show QR (PRD order FR8-13)
Fase 8  Staff & Admin views  → cashier/waiter/admin panels (PRD order FR10-12)
```

Alasan urutan: Fase 0 dipakai semua fase. Order (1-2) independen dari payment
(3-6) kecuali lewat helper auth. Riwayat (7-8) butuh `payment_items` (Fase 0) +
split (Fase 4) sudah ada.

---

## Fase 0 — Fondasi bersama

**Tujuan:** satu helper otorisasi host + tabel `payment_items`. Dipakai semua fase.

### 0.1 Helper otorisasi host (§0.1, §0.6 kedua PRD)
- **File baru** `src/lib/auth-v2/session-auth.ts` (atau tambah di `current.ts`).
- Fungsi:
  - `isSessionHost(sessionId, profileId): Promise<boolean>` — cek
    `table_sessions.host_id === profileId` (**sumber tunggal**, bukan
    `session_members.role`).
  - `assertHostOrActiveStaff(sessionId, profile): Promise<{ isHost, staffRole }>`
    — host ATAU staff aktif di bar sesi; throw kalau bukan keduanya.
- **Refactor** pemakaian ad-hoc yang sudah ada agar konsisten (opsional tapi
  disarankan): `actions.ts:672, 782, 1387` (`host_id === profile.id`).
- ⚠️ Repo pakai **`drizzle-kit push`** (tanpa file migrasi) — perubahan schema
  via `npm run db:push`.

### 0.2 Tabel `payment_items` (PRD order §7.1, Q2A)
- **File** `src/lib/db/schema/orders.ts` — tambah `pgTable("payment_items", …)`:
  `id`, `paymentId → payments.id` (cascade), `orderItemId → order_items.id`
  (restrict), `amount int` (check > 0), `createdAt`. Unique `(payment_id,
  order_item_id)`; index `payment_id`, `order_item_id`.
- Tambah relations + export di `schema/index.ts`.
- Jalankan `npm run db:push` (dev DB lokal — reset script sudah ada:
  `scripts/reset-menu-dev.ts`).

**Acceptance Fase 0:** helper mengembalikan host/staff benar; `payment_items`
ada di DB; typecheck lolos.

---

## Fase 1 — Host-only tambah order (PRD order FR1-3)

- **`addOrderItem`** (`actions.ts:1481-1565`), cabang customer (`else` di
  `:1520-1534`): ganti "joined member" → `isSessionHost`. Non-host throw "Hanya
  host yang bisa menambah pesanan." Cabang staff (`onBehalfOfMemberId`) **tetap**.
- **UI** `SessionView.tsx:1260-1291` (MenuTab): aksi tambah item aktif hanya bila
  `isHost || isStaff`. Non-host → menu read-only + pesan.
- **Test:** host bisa nambah; member non-host ditolak (UI & server); staff via
  on-behalf tetap bisa.

---

## Fase 2 — Pay-before-order (PRD order FR4-7)

- **`addOrderItem`** cabang customer/host: sebelum insert, hitung
  `getOutstandingMap([sessionId])`. Jika `> 0` → throw "Lunasi dulu sisa Rp X."
  - **Hanya `paid`** yang mengurangi outstanding (pending tidak) — sudah sifat
    `getOutstandingMap`. Tak perlu kode tambahan, tapi tulis test-nya.
  - **Staff dikecualikan** (cabang `onBehalfOfMemberId`) — jangan pasang gate di
    situ (FR7/Q1).
- **UI:** tombol tambah pesanan disabled + alasan bila `outstanding > 0`.
- **Test:** order pertama saat open (via `openTable`) lolos; penambahan saat ada
  sisa ditolak; setelah lunas boleh; split pending TIDAK membuka gate.

---

## Fase 3 — Host-only payment + prasyarat payload (PRD pay FR1-3, FR9a)

- **`payShare`** (`actions.ts:1667+`): cabang member (`:1679-1688`) tambah cek
  host via `isSessionHost`; non-host throw. Cabang staff (`:1690-1726`) **tetap**.
- **Payload payment (GAP kritis, PRD pay FR9a):** `page.tsx:203-224` — tambah
  `paid_by_member_id: payments.paidByMemberId` ke select; `page.tsx:338-359` —
  ikutkan ke objek payment. Tambah `paid_by_member_id` ke `interface Payment` di
  `SplitPayment.tsx:33-46`.
- **UI** `SessionView.tsx:1501` (`SplitPayment`): prop `isHost`; sembunyikan blok
  pilih-split + tombol Pay untuk non-host (`payFullOnly` staff tetap).
- **Test:** non-host tak lihat aksi bayar & ditolak server; payload memuat
  `paid_by_member_id`.

---

## Fase 4 — Split batch + QRIS per anggota (PRD pay FR4-8)

- **Action baru** `createSplitBatch({ sessionId, mode, method })` di `actions.ts`
  (FR7b — jangan pakai `paySchema` amount-tunggal):
  - Auth: `isSessionHost` (atau staff).
  - `mode='equal'`: N = anggota joined; share = `ceil(total/N)`; total charge
    di-cap ke `remaining` (FR7a/Q5); anggota terakhir serap selisih.
  - `mode='itemized'`: hanya anggota ber-item; amount = total item-nya;
    **tulis `payment_items`** per item (§0.3).
  - Loop: insert payment `pending` + `split_meta.batchId` (uuid sama) +
    `createCharge` per anggota; error per-anggota tak menggagalkan semua (NFR4).
  - Anti-duplikat: skip anggota yang sudah punya pending belum-expired (FR8).
- **`custom`/treat & staff** tetap lewat `payShare` (1 payment).
- **UI** `SplitTab`/`SplitPayment`: mode equal/itemized memicu `createSplitBatch`;
  tampilkan konfirmasi "QRIS ke N anggota" + daftar status.
- **Test:** N payment tercipta; Σ charge = remaining; itemized menulis
  `payment_items`; batchId konsisten; tekan Split 2× tak dobel.

---

## Fase 5 — Visibilitas QRIS per anggota (PRD pay FR9-11)

- **Filter customer** (`page.tsx` mapping): `qr_string` hanya dikirim bila
  `paid_by_member_id === myMemberId`. Selain itu `null` (termasuk untuk host —
  Q1). Status/nominal tetap.
- **`SplitPayment.tsx`:** non-host lihat "Your QR" (payment pending miliknya) +
  ringkasan + riwayat. Host lihat QR-nya sendiri + status semua.
- **Test:** response anggota A tak memuat `qr_string` milik B; host tak lihat QR
  anggota lain.

---

## Fase 6 — Cancel split batch (PRD pay Q2)

- **Action** `cancelSplitBatch(batchId)` — host-only: set semua payment `pending`
  dgn `split_meta.batchId` cocok → `failed`/`cancelled`; hentikan QR.
- **UI:** tombol "Batalkan split" di panel host bila ada batch pending.
- **Test:** semua pending batch berhenti; yang sudah paid tak tersentuh.

---

## Fase 7 — Riwayat Order-Payment (PRD order FR8-13)

- **Fetch:** join `payment_items` di `page.tsx` payments query (customer) →
  sertakan `items[]` untuk payment `itemized`.
- **`SplitPayment.tsx` "Payments received":** baris `itemized` expandable →
  daftar item + nominal; DP/equal/treat = label+nominal saja (Q2B). Payment
  pending → tombol Show QR (FR9a; customer = pemilik).
- **Test:** itemized tampil rinci; DP/equal tampil ringkas; pending punya Show QR.

---

## Fase 8 — Staff & Admin views (PRD order FR10-12)

- **Cashier/Waiter:** `getSessionDetailForCashier` (`cashier-actions.ts:511-706`)
  join `payment_items`; `CashierPaymentPanel` render expandable + Show QR untuk
  **semua** anggota (staff boleh lihat semua qr_string — PRD pay FR11c). Sediakan
  panel setara di waiter.
- **Admin:** `getTransactionDetail` (`admin.ts:650-875`) join `payment_items`;
  `/admin/transactions/[id]` tampilkan item per payment itemized (per-transaksi,
  Q4).
- **Test:** kasir & waiter bisa expand + Show QR anggota mana pun; admin per
  transaksi menampilkan rincian.

---

## Titik risiko & catatan

1. **`getOutstandingMap` sumber tunggal** — pakai di gate order (Fase 2) & hitung
   share split (Fase 4). Jangan hitung ulang beda tempat.
2. **`drizzle-kit push`** — tak ada file migrasi; hati-hati di production (push
   langsung ubah schema). `payment_items` additive (aman), tapi review sebelum
   push ke DB production.
3. **Race** (NFR4 order): cek outstanding sedekat mungkin dgn insert order.
4. **Kompat mundur:** payment lama tanpa `payment_items`/`batchId` harus tetap
   render (graceful).
5. **Walk-in/no-host:** semua gate host-only **skip** di sesi walk-in (staff yang
   urus). Pastikan cabang staff dilewati gate di Fase 1-3.

---

## Saran pengelompokan commit / PR

- **PR-1 (Fondasi):** Fase 0 — helper + `payment_items`.
- **PR-2 (Order):** Fase 1-2 — host-only order + pay-before-order.
- **PR-3 (Payment inti):** Fase 3-5 — host-only pay + split batch + visibilitas.
- **PR-4 (Batch mgmt):** Fase 6 — cancel batch.
- **PR-5 (Riwayat):** Fase 7-8 — riwayat customer + staff/admin.

Tiap PR: `npm run build`/typecheck + test manual per Acceptance PRD terkait.
Frame production (bukan demo).
