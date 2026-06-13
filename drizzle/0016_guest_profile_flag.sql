-- =====================================================================
-- Guest profile flag
--
-- Untuk walk-in customer yang tidak bawa HP, waiter buka meja atas nama
-- tamu (mis. "Pak Budi"). Konsep "yang punya bill" = tamu, bukan staff.
--
-- Solusi: bikin profile placeholder ("guest profile") yang:
-- - Punya users row dengan fake email (guest-<uuid>@walkin.soho)
-- - Tidak bisa login (passwordHash = NULL, tidak ada accounts row)
-- - Profile row dengan displayName = nama tamu utama
-- - Flag is_guest = true supaya distinguish dari user beneran
--
-- Guest profile jadi host di tableSessions. Waiter join sebagai member
-- biasa supaya bisa input order atas nama tamu.
--
-- Trail "siapa staff yang buka meja ini" tetap di tableSessions.opened_by_staff_id
-- (migration 0015) — guest profile cuma "yang punya bill", waiter "yang nge-handle".
-- =====================================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_guest boolean NOT NULL DEFAULT false;

-- Index untuk filter guest vs real user (untuk cleanup atau laporan walk-in)
CREATE INDEX IF NOT EXISTS idx_profiles_is_guest
  ON profiles(is_guest)
  WHERE is_guest = true;

COMMENT ON COLUMN profiles.is_guest IS
  'TRUE = profile placeholder untuk walk-in customer (tidak ada akun login). FALSE = user real yang punya akun.';
