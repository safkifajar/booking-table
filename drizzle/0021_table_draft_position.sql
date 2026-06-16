-- =====================================================================
-- Draft posisi meja (floor plan editor)
--
-- Admin atur letak meja di editor → posisi disimpan ke kolom DRAFT dulu
-- (auto-save), belum tampil ke customer. Saat admin klik "Simpan Posisi"
-- (publish), draft di-copy ke pos_x/pos_y (yg dipakai floor customer).
--
-- draft NULL = belum ada perubahan draft (editor pakai pos_x/pos_y).
-- =====================================================================

ALTER TABLE tables
  ADD COLUMN IF NOT EXISTS draft_pos_x integer,
  ADD COLUMN IF NOT EXISTS draft_pos_y integer;

COMMENT ON COLUMN tables.draft_pos_x IS
  'Draft posisi X dari floor editor (belum publish). NULL = tidak ada draft.';
COMMENT ON COLUMN tables.draft_pos_y IS
  'Draft posisi Y dari floor editor (belum publish). NULL = tidak ada draft.';
