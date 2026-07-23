-- 0063: pengajuan hapus akun (account_deletion_requests) — soft-delete via
-- approval admin. Approve = set profiles.is_active=false (kolom sudah ada).
--
-- pre-migrate  <- penanda: dijalankan scripts/pre-migrate.sh SEBELUM db:push.
--                CREATE TABLE tabel baru aman, tapi dijalankan di sini supaya
--                db:push melihat skema sudah sinkron & tak ada prompt interaktif.
--
-- Perubahan: tabel BARU account_deletion_requests. status pakai text (bukan
--   enum) mengikuti table_move_requests → hindari ALTER TYPE. Tak ada kolom
--   baru di profiles/users (is_active sudah ada sejak awal).
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS + ADD CONSTRAINT ber-guard + CREATE
--   INDEX IF NOT EXISTS → aman diulang tiap deploy.
--
-- ROLLBACK: DROP TABLE IF EXISTS account_deletion_requests;
--   Aman — tabel murni request, tak dirujuk tabel lain.

CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by uuid NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- FK ber-guard (Postgres tak punya ADD CONSTRAINT IF NOT EXISTS). Nama WAJIB
-- ikut konvensi drizzle-kit (<tabel>_<kolom>_<tabel_tujuan>_<kolom_tujuan>_fk)
-- supaya db:push tak DROP+CREATE ulang tiap deploy. Terverifikasi via drizzle-kit.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'account_deletion_requests_requested_by_profiles_id_fk'
  ) THEN
    ALTER TABLE account_deletion_requests
      ADD CONSTRAINT account_deletion_requests_requested_by_profiles_id_fk
      FOREIGN KEY (requested_by) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'account_deletion_requests_resolved_by_profiles_id_fk'
  ) THEN
    ALTER TABLE account_deletion_requests
      ADD CONSTRAINT account_deletion_requests_resolved_by_profiles_id_fk
      FOREIGN KEY (resolved_by) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_acct_del_req_requested_by
  ON account_deletion_requests (requested_by);

CREATE INDEX IF NOT EXISTS idx_acct_del_req_status
  ON account_deletion_requests (status);
