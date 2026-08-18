-- 0073: halaman link-tree publik (link.<domain>) untuk bio Instagram.
--
-- pre-migrate  <- penanda: dijalankan scripts/pre-migrate.sh SEBELUM db:push.
--                CREATE TABLE + FK + index dibuat lebih dulu supaya db:push
--                melihat skema sudah sinkron (tanpa prompt interaktif).
--
-- Dua bagian:
--   1. bar_links — tautan KUSTOM yang ditambah admin. Tabel terpisah (bukan
--      jsonb) karena isinya daftar yang di-CRUD per baris & diurutkan.
--   2. bars.link_tree_config — judul/subjudul halaman + preferensi tampil
--      untuk 3 tautan BAWAAN (aplikasi, WhatsApp, alamat). Yang bawaan tak
--      disimpan sbg baris: dirakit dari data yang sudah ada supaya ikut
--      berubah kalau nomor WA / alamat berubah.
--
-- IDEMPOTENT: CREATE TABLE/INDEX IF NOT EXISTS + FK ber-guard + ADD COLUMN
-- IF NOT EXISTS.
--
-- ROLLBACK: DROP TABLE IF EXISTS bar_links;
--           ALTER TABLE bars DROP COLUMN IF EXISTS link_tree_config;

CREATE TABLE IF NOT EXISTS bar_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id      uuid NOT NULL,
  label       text NOT NULL,
  url         text NOT NULL,
  icon        text NOT NULL DEFAULT 'link',
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- FK ber-guard (ADD CONSTRAINT tak idempotent). Nama mengikuti konvensi
-- drizzle <table>_<col>_<reftable>_<refcol>_fk supaya db:push tak
-- drop+recreate.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bar_links_bar_id_bars_id_fk'
  ) THEN
    ALTER TABLE bar_links
      ADD CONSTRAINT bar_links_bar_id_bars_id_fk
      FOREIGN KEY (bar_id) REFERENCES bars(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Halaman publik: tautan aktif satu bar, terurut.
CREATE INDEX IF NOT EXISTS idx_bar_links_bar_order
  ON bar_links (bar_id, is_active, sort_order);

ALTER TABLE bars
  ADD COLUMN IF NOT EXISTS link_tree_config jsonb NOT NULL DEFAULT '{}'::jsonb;
