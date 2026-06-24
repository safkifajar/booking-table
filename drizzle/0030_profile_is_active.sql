-- 0030: kolom is_active di profiles. Customer non-aktif tak bisa login.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
