-- 0062: arsip undangan meja (session_invites) — fitur "Undangan Meja".
--
-- pre-migrate  <- penanda: dijalankan scripts/pre-migrate.sh SEBELUM db:push.
--                CREATE TYPE + CREATE TABLE untuk tabel BARU sebetulnya aman di
--                db:push, tapi kita jalankan di sini supaya db:push melihat
--                skema sudah sinkron & tak ada prompt interaktif sama sekali.
--
-- Konteks: tabel `session_invites` LAMA (fitur invite-link) sudah di-drop di
--   migration 0057. Ini tabel BARU dengan struktur berbeda (inviter/invitee +
--   status lifecycle), sebagai ARSIP undangan meja untuk halaman
--   /profile/invites (record siapa mengundang & kapan + status). TERPISAH dari
--   session_members — accept/decline yang ada tak berubah, hanya menambah
--   update status di sini.
--
-- Perubahan:
--   1. enum invite_status (pending/accepted/declined/cancelled) — BARU, belum
--      pernah ada di DB (tabel session_invites lama tak memakai enum ini).
--   2. tabel session_invites (baru) — satu baris per (session, invitee); undang
--      ulang orang yang sama ke sesi sama → ON CONFLICT DO UPDATE (di kode).
--
-- IDEMPOTENT: DO-guard CREATE TYPE + CREATE TABLE IF NOT EXISTS + ADD CONSTRAINT
--   ber-guard + CREATE INDEX IF NOT EXISTS → aman dijalankan berulang tiap deploy.
--
-- ROLLBACK: DROP TABLE IF EXISTS session_invites;  DROP TYPE IF EXISTS invite_status;
--   Aman — tabel murni arsip, tak dirujuk tabel lain.

-- 1. Enum invite_status (guard: CREATE TYPE tak punya IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invite_status') THEN
    CREATE TYPE invite_status AS ENUM ('pending', 'accepted', 'declined', 'cancelled');
  END IF;
END $$;

-- 2. Tabel arsip.
CREATE TABLE IF NOT EXISTS session_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  inviter_id uuid NOT NULL,
  invitee_id uuid NOT NULL,
  status invite_status NOT NULL DEFAULT 'pending',
  invited_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);

-- FK dipasang ber-guard supaya idempotent (Postgres tak punya ADD CONSTRAINT
-- IF NOT EXISTS). Nama constraint WAJIB mengikuti konvensi drizzle-kit
-- (<tabel>_<kolom>_<tabel_tujuan>_<kolom_tujuan>_fk); kalau tidak, db:push
-- menganggapnya asing → DROP+CREATE ulang tiap deploy. Terverifikasi lewat
-- `drizzle-kit push` saat migrasi ditulis.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'session_invites_session_id_table_sessions_id_fk'
  ) THEN
    ALTER TABLE session_invites
      ADD CONSTRAINT session_invites_session_id_table_sessions_id_fk
      FOREIGN KEY (session_id) REFERENCES table_sessions(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'session_invites_inviter_id_profiles_id_fk'
  ) THEN
    ALTER TABLE session_invites
      ADD CONSTRAINT session_invites_inviter_id_profiles_id_fk
      FOREIGN KEY (inviter_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'session_invites_invitee_id_profiles_id_fk'
  ) THEN
    ALTER TABLE session_invites
      ADD CONSTRAINT session_invites_invitee_id_profiles_id_fk
      FOREIGN KEY (invitee_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Satu undangan per (session, invitee) — undang ulang = ON CONFLICT DO UPDATE.
-- WAJIB berupa UNIQUE CONSTRAINT (bukan CREATE UNIQUE INDEX): schema drizzle
-- memakai unique("...") → constraint. Kalau di sini dibuat sbg index, db:push
-- melihatnya beda objek → DROP index + ADD constraint tiap deploy. Ber-guard
-- karena Postgres tak punya ADD CONSTRAINT IF NOT EXISTS.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_session_invites_session_invitee'
  ) THEN
    ALTER TABLE session_invites
      ADD CONSTRAINT uq_session_invites_session_invitee
      UNIQUE (session_id, invitee_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_session_invites_invitee
  ON session_invites (invitee_id);

CREATE INDEX IF NOT EXISTS idx_session_invites_session
  ON session_invites (session_id);
