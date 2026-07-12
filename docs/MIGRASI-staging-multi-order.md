# Migrasi DB Staging — Multi-Order + Payment Rework

Setelah deploy `origin/staging` (commit `b2c5334`), DB staging **wajib** di-update.
Tanpa ini app akan error (kolom/enum/tabel belum ada).

## Perubahan schema yang dibutuhkan
1. **Tabel baru `payment_items`** (penautan payment → order_items).
2. **Enum `order_status`** tambah nilai `unpaid` + `paid`.
3. **Kolom `orders.paid_at`** (timestamptz).
4. **Index**: drop `uq_open_order_per_session`, tambah `uq_unpaid_order_per_session`
   (maks 1 order unpaid per sesi) + `idx_orders_session`.

## Langkah di server staging

### 1. Pastikan `.env.local` staging menunjuk DB staging
```bash
grep DATABASE_URL .env.local   # cek host benar (bukan localhost dev)
```

### 2. Push schema (drizzle-kit)
```bash
npx drizzle-kit push --force
```
> `--force` melewati prompt interaktif. Aman dijalankan — perubahan bersifat
> **additive** (tambah tabel/kolom/enum-value/index; drop index lama yg tak
> dipakai lagi). Tidak menghapus data.

### 3. Backfill order lama → `paid`
Order yang sudah ada di staging masih berstatus `open` (nilai lama). Set jadi
`paid` supaya diperlakukan sebagai "sudah masuk" (tak jadi unpaid).

Jalankan SQL ini (via psql / GUI DB / script):
```sql
UPDATE orders
SET status = 'paid', paid_at = COALESCE(paid_at, created_at)
WHERE status IN ('open', 'submitted', 'preparing', 'served');
```

### 4. Verifikasi
```sql
-- tabel payment_items ada?
SELECT column_name FROM information_schema.columns WHERE table_name = 'payment_items';
-- orders punya paid_at + status baru?
SELECT status, count(*) FROM orders GROUP BY status;
-- harusnya hanya 'paid' / 'closed' (tak ada 'open')
```

## Catatan Duitku (testing pembayaran nyata)
- Set `PAYMENT_GATEWAY=duitku` di env staging (kalau mau QRIS asli, bukan mock).
- Pastikan kredensial Duitku (merchantCode, apiKey, base URL) sudah di env.
- Callback URL Duitku harus menunjuk ke:
  `https://<staging-host>/api/payments/duitku/callback`
- Alur baru: order dibuat `unpaid` → bayar via QRIS → callback Duitku `resultCode=00`
  → `markPaymentPaidBySystem` → **prepaid hook** set order `paid` + item `sent`
  (masuk dapur). Pastikan callback bisa diakses dari server Duitku (bukan localhost).

## Rollback (kalau perlu)
Perubahan additive, jadi rollback kode cukup. Kolom/tabel baru boleh dibiarkan
(tak mengganggu versi lama), atau:
```sql
-- HANYA jika benar-benar mau bersihkan (hati-hati, hapus data payment_items):
-- DROP TABLE payment_items;
-- ALTER TABLE orders DROP COLUMN paid_at;
```
(enum value tak bisa di-drop di Postgres — biarkan saja, tak masalah.)
