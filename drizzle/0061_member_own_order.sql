-- 0061: order milik ANGGOTA (pesan sendiri, wajib bayar sendiri).
--
-- pre-migrate  <- penanda: dijalankan scripts/pre-migrate.sh SEBELUM db:push.
--
-- Kenapa WAJIB pre-migrate, bukan db:push:
--   Migrasi ini MENGGANTI definisi unique index yang sudah ada
--   (uq_unpaid_order_per_session). drizzle-kit menganggap perubahan UNIQUE pada
--   tabel berisi data sebagai operasi berisiko → memunculkan prompt interaktif
--   "Do you want to truncate orders?" yang MENGGANTUNG deploy di SSH non-TTY.
--   Dijalankan di sini lebih dulu supaya db:push melihat skema sudah sinkron.
--
-- Perubahan:
--   1. orders.owner_member_id (nullable, FK -> session_members, ON DELETE SET NULL)
--      NULL   = order MEJA (dibuat host/staff) — perilaku lama, host tetap
--               punya split equally & treat di sana.
--      terisi = order milik seorang anggota: dia bayar penuh ordernya sendiri,
--               tanpa split.
--      Nullable disengaja: SEMUA order lama bernilai NULL dan itu SAH.
--   2. uq_unpaid_order_per_session dipersempit -> hanya berlaku utk order meja
--      (owner_member_id IS NULL). Tanpa ini, satu anggota yang punya order
--      unpaid akan memblokir SELURUH meja.
--   3. uq_unpaid_order_per_member (baru) -> maks 1 order unpaid per anggota,
--      menegakkan aturan "wajib langsung bayar" tanpa saling menghalangi.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS + DROP INDEX IF EXISTS + CREATE UNIQUE
--   INDEX IF NOT EXISTS -> aman dijalankan berulang tiap deploy.
--
-- ROLLBACK (kalau perlu): urutan terbalik — DROP kedua index baru, lalu
--   CREATE UNIQUE INDEX uq_unpaid_order_per_session ON orders (session_id)
--   WHERE status = 'unpaid';  lalu DROP COLUMN owner_member_id.
--   Aman selama belum ada order milik anggota (owner_member_id IS NOT NULL).

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS owner_member_id uuid;

-- FK dipasang terpisah + dicek dulu, supaya idempotent (Postgres tak punya
-- ADD CONSTRAINT IF NOT EXISTS).
--
-- PENTING: nama constraint HARUS mengikuti konvensi drizzle-kit
-- (<tabel>_<kolom>_<tabel_tujuan>_<kolom_tujuan>_fk). Kalau dinamai lain,
-- db:push menganggapnya constraint asing → DROP lalu CREATE ulang FK ini
-- setiap deploy. Terverifikasi lewat `drizzle-kit push` saat migrasi ditulis.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_owner_member_id_session_members_id_fk'
  ) THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_owner_member_id_session_members_id_fk
      FOREIGN KEY (owner_member_id) REFERENCES session_members(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Index lama diganti yang dipersempit. DROP dulu supaya definisi WHERE-nya
-- benar-benar ter-update (CREATE ... IF NOT EXISTS tidak mengubah yg sudah ada).
DROP INDEX IF EXISTS uq_unpaid_order_per_session;

CREATE UNIQUE INDEX IF NOT EXISTS uq_unpaid_order_per_session
  ON orders (session_id)
  WHERE status = 'unpaid' AND owner_member_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_unpaid_order_per_member
  ON orders (owner_member_id)
  WHERE status = 'unpaid' AND owner_member_id IS NOT NULL;
