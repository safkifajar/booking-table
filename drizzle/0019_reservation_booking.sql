-- =====================================================================
-- Reservation booking
--
-- Customer bisa buka meja untuk waktu sekarang (langsung pakai) atau
-- untuk waktu di masa depan (reservasi). Single flow lewat OpenTable form.
--
-- Schema changes:
--
-- 1. session_status enum: tambah value 'reserved'
--    - 'reserved': meja di-block untuk waktu booking, belum aktif
--    - 'open': meja aktif (saat ini dipakai)
--    - lifecycle: reserved → open (saat waktu booking tiba) → closed
--
-- 2. table_sessions.reservation_at: timestamp kapan booking dimulai
--    - NULL = walk-in / immediate (status='open' langsung)
--    - Set + status='reserved' = future booking
--    - Set + status='open' = booking yang sudah aktif
--
-- 3. table_sessions.dp_paid_at: timestamp kapan DP dibayar (kalau ada)
--    - NULL = no DP required atau belum bayar
--    - Set = DP sudah terverify
-- =====================================================================

-- 1. Add 'reserved' value ke session_status enum
ALTER TYPE session_status ADD VALUE IF NOT EXISTS 'reserved' BEFORE 'open';

-- 2. Add reservation_at + dp_paid_at columns
ALTER TABLE table_sessions
  ADD COLUMN IF NOT EXISTS reservation_at timestamp,
  ADD COLUMN IF NOT EXISTS dp_paid_at timestamp;

-- Index untuk filter upcoming reservations (efficient query "what's reserved today")
CREATE INDEX IF NOT EXISTS idx_sessions_reservation_at
  ON table_sessions(reservation_at)
  WHERE reservation_at IS NOT NULL;

-- Index khusus untuk reserved status (cepat untuk floor view + cleanup cron)
CREATE INDEX IF NOT EXISTS idx_sessions_status_reserved
  ON table_sessions(status, reservation_at)
  WHERE status = 'reserved';

-- 3. Update unique constraint per-table: include reserved sessions
-- Existing constraint cuma cover ('open', 'locked'). Kita expand untuk
-- include 'reserved' juga supaya tidak bisa double-booking meja.
DROP INDEX IF EXISTS uq_active_session_per_table;
CREATE UNIQUE INDEX uq_active_session_per_table
  ON table_sessions(table_id)
  WHERE status IN ('reserved', 'open', 'locked');

COMMENT ON COLUMN table_sessions.reservation_at IS
  'Kapan reservasi dimulai. NULL = walk-in immediate. Set = booking untuk waktu tertentu.';

COMMENT ON COLUMN table_sessions.dp_paid_at IS
  'Timestamp DP terverify. NULL = no DP required atau belum bayar.';
