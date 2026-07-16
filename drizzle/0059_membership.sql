-- 0059: fondasi membership — enum + tabel level + SEED 3 level (PRD Membership 4.1).
--
-- pre-migrate  <- penanda: dijalankan scripts/pre-migrate.sh SEBELUM db:push.
--
-- KENAPA HARUS PRE-MIGRATE: db:push akan menambah kolom
-- profiles.membership_level NOT NULL DEFAULT 'basic' dengan FK ke
-- membership_levels.key. Saat kolom ditambahkan, SEMUA baris profiles yang
-- sudah ada langsung terisi 'basic' — kalau baris 'basic' belum ada di
-- membership_levels, FK violation dan push gagal. Jadi tabel + seed harus
-- sudah ada lebih dulu.
--
-- DDL di bawah HARUS SAMA PERSIS dengan src/lib/db/schema/membership.ts
-- (kalau beda, db:push mengusulkan ALTER).
--
-- Tabel lain (membership_vouchers, membership_transactions) & enum-nya
-- dibiarkan ke db:push — non-destruktif, tak ada baris existing yang
-- menunjuk ke sana.
--
-- IDEMPOTENT: DO..EXCEPTION utk enum, IF NOT EXISTS utk tabel,
-- ON CONFLICT DO NOTHING utk seed -> aman dijalankan berulang.

DO $$ BEGIN
  CREATE TYPE "public"."membership_billing_period" AS ENUM ('one_time', 'monthly', 'yearly');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "membership_levels" (
  "key" text PRIMARY KEY NOT NULL,
  "rank" integer NOT NULL,
  "name" text NOT NULL,
  "price" integer DEFAULT 0 NOT NULL,
  "billing_period" "membership_billing_period" DEFAULT 'monthly' NOT NULL,
  "description" text,
  "is_purchasable" boolean DEFAULT true NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_membership_levels_rank" UNIQUE("rank"),
  CONSTRAINT "ck_membership_levels_price" CHECK ("membership_levels"."price" >= 0)
);

-- Seed 3 level. Harga awal placeholder — admin mengubahnya di /admin/membership.
INSERT INTO "membership_levels"
  ("key", "rank", "name", "price", "billing_period", "description", "is_purchasable")
VALUES
  ('basic',   1, 'Basic',   0,      'monthly', 'Free membership for every member. Connect with fellow Basic members and your friends.', false),
  ('premium', 2, 'Premium', 150000, 'monthly', 'See and connect with Basic & Premium members, and unlock their stories.', true),
  ('vip',     3, 'VIP',     500000, 'monthly', 'Full access — see and connect with every member, including VIP-only stories.', true)
ON CONFLICT ("key") DO NOTHING;
