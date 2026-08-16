-- 0070: pengingat menjelang jam booking.
--
-- pre-migrate  <- penanda: dijalankan scripts/pre-migrate.sh SEBELUM db:push.
--                Nilai enum & kolom dibuat lebih dulu supaya db:push melihat
--                skema sudah sinkron (tanpa prompt interaktif).
--
-- Dua perubahan:
--   1. notification_type += 'booking_reminder' (jenis notif baru).
--   2. table_sessions.reminder_sent_at — penanda anti-dobel. Cron jalan
--      berkala; tanpa penanda ini tamu dikirimi pengingat berulang setiap
--      cron menyala.
--
-- IDEMPOTENT: ADD VALUE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS.
--
-- ROLLBACK: ALTER TABLE table_sessions DROP COLUMN IF EXISTS reminder_sent_at;
--           (nilai enum tak bisa di-drop di Postgres — aman dibiarkan.)

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'booking_reminder';

ALTER TABLE table_sessions
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

-- Cron memindai sesi 'reserved' yang jam bookingnya sudah dekat & belum
-- dikirimi pengingat. Index parsial supaya pemindaian tetap murah walau
-- riwayat reservasi menumpuk.
CREATE INDEX IF NOT EXISTS idx_sessions_reminder_pending
  ON table_sessions (reservation_at)
  WHERE reminder_sent_at IS NULL AND reservation_at IS NOT NULL;
