-- =====================================================================
-- Staff input audit trail
--
-- Konsep walk-in customer: staff (waiter/cashier) bukan member meja, tapi
-- operator yang bantu input order atas nama tamu. Member meja = pure customer
-- (guest profile atau real user).
--
-- Untuk audit "siapa staff yang input order item ini", tambah kolom:
--   order_items.input_by_staff_id (FK profiles, nullable)
--
-- NULL = customer add sendiri (added_by_member_id sudah cukup identifikasi)
-- Set = staff add atas nama member (added_by_member_id = guest, input_by_staff_id = waiter)
-- =====================================================================

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS input_by_staff_id uuid
    REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_order_items_input_by_staff
  ON order_items(input_by_staff_id)
  WHERE input_by_staff_id IS NOT NULL;

COMMENT ON COLUMN order_items.input_by_staff_id IS
  'Staff yang input order ini atas nama customer (untuk walk-in). NULL = customer add sendiri.';
