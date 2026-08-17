-- 0072: gambar pendukung di notifikasi (mis. banner promo).
--
-- pre-migrate  <- penanda: dijalankan scripts/pre-migrate.sh SEBELUM db:push.
--
-- notifications.image_url — tampil sbg thumbnail di list in-app, dan
-- dikirim sbg `image` di payload web push (gambar besar di Chrome/Android).
-- NULL = notif tanpa gambar (perilaku lama, tak berubah).
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS.
--
-- ROLLBACK: ALTER TABLE notifications DROP COLUMN IF EXISTS image_url;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS image_url text;
