-- 0064: kategori banner (promo/event) untuk fitur "Promo & Event".
--
-- pre-migrate  <- penanda: dijalankan scripts/pre-migrate.sh SEBELUM db:push.
--                Melibatkan CREATE TYPE (enum) + ADD COLUMN pada tabel berisi
--                data → db:push --force bisa memunculkan prompt interaktif yg
--                menggantung CI. Dijalankan di sini lebih dulu supaya db:push
--                melihat skema sudah sinkron.
--
-- Perubahan:
--   1. enum banner_category (promo/event) — BARU.
--   2. bar_banners.category (NOT NULL DEFAULT 'promo') — banner lama otomatis
--      berkategori 'promo' tanpa backfill terpisah.
--
-- IDEMPOTENT: CREATE TYPE ber-guard + ADD COLUMN IF NOT EXISTS → aman diulang.
--
-- ROLLBACK: ALTER TABLE bar_banners DROP COLUMN IF EXISTS category;
--   DROP TYPE IF EXISTS banner_category;

-- 1. Enum (guard: CREATE TYPE tak punya IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'banner_category') THEN
    CREATE TYPE banner_category AS ENUM ('promo', 'event');
  END IF;
END $$;

-- 2. Kolom (default 'promo' → baris existing valid tanpa backfill).
ALTER TABLE bar_banners
  ADD COLUMN IF NOT EXISTS category banner_category NOT NULL DEFAULT 'promo';
