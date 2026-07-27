-- 0065: story teks (selain story foto). Menambah kind + bg_color, dan membuat
-- image_url nullable (story teks tak punya gambar).
--
-- pre-migrate  <- dijalankan scripts/pre-migrate.sh SEBELUM db:push. Melibatkan
--                CREATE TYPE (enum) + ALTER COLUMN DROP NOT NULL + ADD CHECK
--                pada tabel berisi data → db:push --force bisa memunculkan
--                prompt interaktif yg menggantung CI. Dijalankan lebih dulu di
--                sini supaya db:push melihat skema sudah sinkron.
--
-- Perubahan:
--   1. enum story_kind (image/text) — BARU.
--   2. stories.kind (NOT NULL DEFAULT 'image') — story lama otomatis 'image'.
--   3. stories.bg_color (nullable) — warna latar story teks.
--   4. stories.image_url → DROP NOT NULL (story teks null-kan kolom ini).
--   5. check ck_stories_kind_payload — image wajib imageUrl, text wajib caption.
--   6. enum story_text_style + stories.text_style (NOT NULL DEFAULT 'classic')
--      — gaya tipografi story teks (mirip "Aa" WhatsApp).
--   7. stories.mentions (uuid[] NOT NULL DEFAULT '{}') — profil yg di-tag @user.
--
-- IDEMPOTENT: enum ber-guard, ADD COLUMN IF NOT EXISTS, DROP NOT NULL &
--   ADD CONSTRAINT ber-guard → aman diulang.
--
-- ROLLBACK:
--   ALTER TABLE stories DROP CONSTRAINT IF EXISTS ck_stories_kind_payload;
--   ALTER TABLE stories DROP COLUMN IF EXISTS text_style;
--   ALTER TABLE stories DROP COLUMN IF EXISTS bg_color;
--   ALTER TABLE stories DROP COLUMN IF EXISTS kind;
--   ALTER TABLE stories ALTER COLUMN image_url SET NOT NULL; -- hati2 kalau ada baris teks
--   DROP TYPE IF EXISTS story_text_style;
--   DROP TYPE IF EXISTS story_kind;

-- 1. Enum (guard: CREATE TYPE tak punya IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'story_kind') THEN
    CREATE TYPE story_kind AS ENUM ('image', 'text');
  END IF;
END $$;

-- 2. Kolom kind (default 'image' → baris existing valid tanpa backfill).
ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS kind story_kind NOT NULL DEFAULT 'image';

-- 3. Kolom bg_color (nullable).
ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS bg_color text;

-- 4. image_url jadi nullable (story teks tak isi ini).
ALTER TABLE stories
  ALTER COLUMN image_url DROP NOT NULL;

-- 5. Check konsistensi payload per tipe (guard: ADD CONSTRAINT tak idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_stories_kind_payload'
  ) THEN
    ALTER TABLE stories ADD CONSTRAINT ck_stories_kind_payload CHECK (
      (kind = 'image' AND image_url IS NOT NULL)
      OR (kind = 'text' AND caption IS NOT NULL)
    );
  END IF;
END $$;

-- 6. Enum + kolom gaya tipografi story teks (mirip "Aa" WhatsApp).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'story_text_style') THEN
    CREATE TYPE story_text_style AS ENUM ('classic', 'serif', 'mono', 'strong');
  END IF;
END $$;

ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS text_style story_text_style NOT NULL DEFAULT 'classic';

-- 7. Kolom mentions (uuid[]) — profil yang di-tag via @username di story.
ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS mentions uuid[] NOT NULL DEFAULT '{}';
