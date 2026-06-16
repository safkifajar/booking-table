-- =====================================================================
-- Meja draft (floor plan editor)
--
-- Meja yang baru ditambah di editor = draft (is_draft=true) → BELUM tampil
-- ke customer sampai admin klik "Simpan Posisi" (publish). Saat publish,
-- semua meja draft di area di-set is_draft=false.
--
-- Meja existing: is_draft=false (sudah live).
-- =====================================================================

ALTER TABLE tables
  ADD COLUMN IF NOT EXISTS is_draft boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN tables.is_draft IS
  'Meja baru dari floor editor yg belum di-publish (tak tampil ke customer).';
