-- =====================================================================
-- Reservation time range (jam mulai - jam selesai)
--
-- Sebelumnya reservasi cuma punya 1 titik waktu (reservation_at = mulai).
-- Sekarang customer pilih rentang: mulai (reservation_at) + selesai
-- (reservation_end_at). Mis. "14:00 - 17:00".
--
-- Implikasi double-booking:
--   Satu meja boleh punya BANYAK reservasi di slot waktu berbeda
--   (14:00-16:00 oleh A, 18:00-20:00 oleh B). Yang dilarang adalah
--   OVERLAP antar rentang. Karena overlap tidak bisa di-enforce dengan
--   unique index biasa, cek bentrok dipindah ke logika aplikasi
--   (query overlap di openTable). Unique index per-table dilonggarkan:
--   tetap cegah >1 session 'open'/'locked', tapi izinkan banyak 'reserved'.
-- =====================================================================

-- 1. Kolom jam selesai reservasi
ALTER TABLE table_sessions
  ADD COLUMN IF NOT EXISTS reservation_end_at timestamp;

COMMENT ON COLUMN table_sessions.reservation_end_at IS
  'Kapan reservasi berakhir. NULL untuk walk-in. Set bersama reservation_at untuk booking range.';

-- 2. Longgarkan unique index: hanya 1 session AKTIF (open/locked) per meja.
--    Reservasi (reserved) boleh banyak — overlap dicegah di aplikasi.
DROP INDEX IF EXISTS uq_active_session_per_table;
CREATE UNIQUE INDEX uq_active_session_per_table
  ON table_sessions(table_id)
  WHERE status IN ('open', 'locked');

-- 3. Index untuk overlap query: cari reservasi 'reserved' per meja by waktu.
CREATE INDEX IF NOT EXISTS idx_sessions_reserved_range
  ON table_sessions(table_id, reservation_at, reservation_end_at)
  WHERE status = 'reserved';
