-- 0068: kolom actor_id di notifications — untuk menampilkan FOTO PROFIL
-- pengirim di list notifikasi (ala Instagram).
--
-- pre-migrate  <- penanda: dijalankan scripts/pre-migrate.sh SEBELUM db:push.
--                ADD COLUMN + FK pada tabel berisi data bisa memunculkan prompt
--                interaktif di db:push --force. Dijalankan lebih dulu di sini
--                supaya db:push melihat skema sudah sinkron.
--
-- Perubahan:
--   1. notifications.actor_id (uuid, nullable, FK profiles ON DELETE SET NULL)
--      — profil pengirim notif. NULL = notif sistem (pembayaran/booking), UI
--      menampilkan ikon per jenis.
--
-- Notif LAMA dibiarkan actor_id NULL (tak ada backfill): datanya tak menyimpan
-- siapa pengirim, dan menebak dari teks judul berisiko salah.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS + FK ber-guard -> aman diulang.
--
-- ROLLBACK:
--   ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_actor_id_profiles_id_fk;
--   ALTER TABLE notifications DROP COLUMN IF EXISTS actor_id;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS actor_id uuid;

-- FK (guard: ADD CONSTRAINT tak idempotent). Nama mengikuti konvensi drizzle
-- <table>_<col>_<reftable>_<refcol>_fk supaya db:push tak drop+recreate.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notifications_actor_id_profiles_id_fk'
  ) THEN
    ALTER TABLE notifications
      ADD CONSTRAINT notifications_actor_id_profiles_id_fk
      FOREIGN KEY (actor_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
