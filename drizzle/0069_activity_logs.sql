-- 0069: tabel activity_logs — jejak "siapa staff melakukan apa, kapan".
--
-- pre-migrate  <- penanda: dijalankan scripts/pre-migrate.sh SEBELUM db:push.
--                CREATE TABLE + FK + index dibuat lebih dulu di sini supaya
--                db:push melihat skema sudah sinkron (tanpa prompt interaktif).
--
-- Dipakai halaman admin /admin/activity untuk mengawasi kerja kasir/waiter.
--
-- Catatan desain:
--   - actor_name & actor_role disimpan sbg TEKS (snapshot saat kejadian), jadi
--     riwayat tetap akurat walau nama/role staff berubah atau akun dihapus.
--   - actor_id FK ON DELETE SET NULL — hapus akun tak menghapus riwayatnya.
--   - bar_id ON DELETE CASCADE — log ikut terhapus kalau bar dihapus.
--
-- IDEMPOTENT: CREATE TABLE/INDEX IF NOT EXISTS + FK ber-guard → aman diulang.
--
-- ROLLBACK: DROP TABLE IF EXISTS activity_logs;

CREATE TABLE IF NOT EXISTS activity_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid,
  actor_name  text NOT NULL,
  actor_role  text NOT NULL,
  bar_id      uuid NOT NULL,
  action      text NOT NULL,
  category    text NOT NULL,
  entity_type text,
  entity_id   uuid,
  summary     text NOT NULL,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- FK (guard: ADD CONSTRAINT tak idempotent). Nama mengikuti konvensi drizzle
-- <table>_<col>_<reftable>_<refcol>_fk supaya db:push tak drop+recreate.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'activity_logs_actor_id_profiles_id_fk'
  ) THEN
    ALTER TABLE activity_logs
      ADD CONSTRAINT activity_logs_actor_id_profiles_id_fk
      FOREIGN KEY (actor_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'activity_logs_bar_id_bars_id_fk'
  ) THEN
    ALTER TABLE activity_logs
      ADD CONSTRAINT activity_logs_bar_id_bars_id_fk
      FOREIGN KEY (bar_id) REFERENCES bars(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_activity_logs_bar_at
  ON activity_logs (bar_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_logs_actor_at
  ON activity_logs (actor_id, created_at);
