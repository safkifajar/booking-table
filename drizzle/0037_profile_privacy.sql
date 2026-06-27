-- 0037: flag privacy profil — sembunyikan item sensitif dari user lain.
-- Default false = tampil (perilaku lama tetap).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS hide_history boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hide_location boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hide_age boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hide_social boolean NOT NULL DEFAULT false;
