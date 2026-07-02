-- 0045: galeri foto profil (maks 3; photos[0] = avatar utama).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS photos text[] NOT NULL DEFAULT '{}';
