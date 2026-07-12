-- 0056: tambah nilai 'cancelled' ke enum order_status.
--
-- pre-migrate  ← penanda: dijalankan scripts/pre-migrate.sh SEBELUM db:push.
--                ADD VALUE ke enum tak bisa ditangani drizzle push mulus &
--                harus di luar transaksi campuran → aman dijalankan lebih dulu.
--
-- Dipakai untuk order unpaid yang DIBATALKAN customer (klik "kembali" dari
-- halaman pembayaran order baru). Order + payment pending dibatalkan; order
-- 'cancelled' tak muncul di dapur/kasir/tagihan.
--
-- IDEMPOTENT: ADD VALUE IF NOT EXISTS → aman dijalankan berulang.
-- Catatan: ALTER TYPE ... ADD VALUE tidak boleh berada dalam blok transaksi
-- yang sama dengan pemakaian nilai barunya; di sini berdiri sendiri → aman.

ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'cancelled';
