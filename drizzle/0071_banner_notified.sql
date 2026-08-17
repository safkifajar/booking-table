-- 0071: notifikasi "promo baru" ke customer saat banner MULAI TAYANG.
--
-- pre-migrate  <- penanda: dijalankan scripts/pre-migrate.sh SEBELUM db:push.
--
-- bar_banners.notified_at = penanda anti-dobel. Cron jalan berkala; tanpa
-- penanda ini SELURUH customer dikirimi notif berulang tiap cron menyala.
--
-- Banner yang SUDAH tayang saat migrasi ini jalan ditandai terkirim, supaya
-- promo lama tak tiba-tiba membanjiri customer dengan notif "baru".
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS + UPDATE ber-guard.
--
-- ROLLBACK: ALTER TABLE bar_banners DROP COLUMN IF EXISTS notified_at;

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'promo_new';

ALTER TABLE bar_banners
  ADD COLUMN IF NOT EXISTS notified_at timestamptz;

-- Backfill sekali: anggap banner yang sudah tayang sudah "diumumkan".
-- Hanya menyentuh baris yang masih NULL, jadi aman diulang.
UPDATE bar_banners
SET notified_at = now()
WHERE notified_at IS NULL
  AND is_active = true
  AND (starts_at IS NULL OR starts_at <= now());

-- Cron memindai banner aktif yang sudah waktunya tayang & belum diumumkan.
CREATE INDEX IF NOT EXISTS idx_bar_banners_notify_pending
  ON bar_banners (starts_at)
  WHERE notified_at IS NULL;
