-- =====================================================================
-- Walk-in customer tracking
--
-- Tambah 2 kolom di table_sessions untuk support waiter buka meja atas
-- nama tamu (customer yang tidak bawa HP / walk-in):
--
-- 1. opened_by_staff_id: FK ke profiles. NULL untuk session yang dibuka
--    customer sendiri (self-service via scan QR). Set untuk session yang
--    dibuka staff (waiter/cashier/manager) atas nama tamu.
--
-- 2. guest_names: text[]. List nama tamu yang duduk di meja (free text).
--    Max length = table.capacity (enforce di app layer, bukan DB).
--    Default empty array.
-- =====================================================================

ALTER TABLE table_sessions
  ADD COLUMN IF NOT EXISTS opened_by_staff_id uuid
    REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS guest_names text[] NOT NULL DEFAULT '{}'::text[];

-- Index untuk filter "session yang dibuka staff" (untuk laporan walk-in)
CREATE INDEX IF NOT EXISTS idx_sessions_opened_by_staff
  ON table_sessions(opened_by_staff_id)
  WHERE opened_by_staff_id IS NOT NULL;

COMMENT ON COLUMN table_sessions.opened_by_staff_id IS
  'Staff yang buka meja ini. NULL = customer self-service. Set = walk-in (dibantu waiter/cashier).';

COMMENT ON COLUMN table_sessions.guest_names IS
  'List nama tamu di meja (untuk walk-in). Empty array kalau session customer regular.';
