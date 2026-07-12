-- 0055: kolom username (handle) di profiles + constraint UNIK.
--
-- pre-migrate  ← penanda: dijalankan scripts/pre-migrate.sh SEBELUM db:push
--                (biar push tak minta prompt "truncate profiles?" di CI).
--
-- Format app-level: ^[a-z0-9_]{3,20}$ (lowercase). Divalidasi di aplikasi
-- (src/lib/utils.ts normalizeUsername), bukan CHECK constraint — biar pesan
-- error ramah & aturan bisa berevolusi tanpa migrasi.
--
-- NULLABLE: user lama & guest walk-in tak punya username (NULL). PostgreSQL
-- UNIQUE mengabaikan NULL, jadi banyak baris NULL tetap boleh. Hanya
-- registrasi baru yang wajib mengisi (dipaksa di layer aplikasi).
--
-- IDEMPOTENT: aman dijalankan berulang.
--   - ADD COLUMN IF NOT EXISTS → aman.
--   - Constraint dibungkus DO-block cek pg_constraint → tak ada IF NOT EXISTS
--     bawaan untuk ADD CONSTRAINT, jadi kita cek manual.
--
-- PENTING: file ini dijalankan SEBELUM `drizzle-kit push` (lihat deploy.sh,
-- blok "pre-migrate DDL"). Tujuannya: begitu push jalan, kolom + constraint
-- sudah ada → drizzle melihat skema sinkron → TIDAK memunculkan prompt
-- interaktif "truncate profiles?" yang akan menggantung CI.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS username text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_profiles_username'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT uq_profiles_username UNIQUE (username);
  END IF;
END $$;
