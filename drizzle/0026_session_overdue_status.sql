-- =====================================================================
-- Status 'overdue' untuk session_status
--
-- Reservasi/sesi yang waktunya lewat TAPI tagihan belum lunas TIDAK lagi
-- di-close diam-diam (yang menyebabkan tunggakan hilang & tak tertagih).
-- Sebaliknya jadi 'overdue': tetap dianggap aktif/terisi (muncul di kasir,
-- meja tak bisa dibooking ulang) sampai dilunasi → baru jadi 'closed'.
--
-- 1. Tambah nilai enum 'overdue'.
-- 2. Index okupansi tunggal per meja (uq_active_session_per_table) diperluas
--    agar 'overdue' juga dihitung sebagai okupansi → tetap cuma 1 sesi
--    open/locked/overdue per meja.
-- =====================================================================

-- 1. Nilai enum baru. ADD VALUE tidak boleh dalam transaksi yg juga memakainya;
--    dijalankan sendiri (idempotent).
ALTER TYPE session_status ADD VALUE IF NOT EXISTS 'overdue';

-- 2. Recreate unique index okupansi dengan 'overdue' masuk predikat.
--    (index lama dibuat di 0020_reservation_time_range.sql: WHERE status IN
--    ('open','locked')). Drop dulu lalu buat ulang.
DROP INDEX IF EXISTS uq_active_session_per_table;
CREATE UNIQUE INDEX uq_active_session_per_table
  ON table_sessions (table_id)
  WHERE status IN ('open', 'locked', 'overdue');
