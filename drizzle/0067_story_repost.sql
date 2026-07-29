-- 0067: repost story dari mention (kartu embed "via @pembuat" ala IG).
--
-- pre-migrate  <- penanda: dijalankan scripts/pre-migrate.sh SEBELUM db:push.
--                ADD COLUMN + FK pada tabel berisi data bisa memunculkan prompt
--                interaktif di db:push --force. Dijalankan lebih dulu di sini
--                supaya db:push melihat skema sudah sinkron.
--
-- Perubahan:
--   1. stories.repost_of_author_id (uuid, nullable, FK profiles ON DELETE SET
--      NULL) — profileId pembuat ASLI story yg di-repost. Null = original.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS + FK ber-guard -> aman diulang.
--
-- ROLLBACK:
--   ALTER TABLE stories DROP CONSTRAINT IF EXISTS stories_repost_of_author_id_profiles_id_fk;
--   ALTER TABLE stories DROP COLUMN IF EXISTS repost_of_author_id;

ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS repost_of_author_id uuid;

-- FK (guard: ADD CONSTRAINT tak idempotent). Nama mengikuti konvensi drizzle
-- <table>_<col>_<reftable>_<refcol>_fk supaya db:push tak drop+recreate.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stories_repost_of_author_id_profiles_id_fk'
  ) THEN
    ALTER TABLE stories
      ADD CONSTRAINT stories_repost_of_author_id_profiles_id_fk
      FOREIGN KEY (repost_of_author_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
