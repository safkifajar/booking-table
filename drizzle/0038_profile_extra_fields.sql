-- 0038: field profil tambahan (semua opsional/nullable).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS area text,
  ADD COLUMN IF NOT EXISTS looking_for text,
  ADD COLUMN IF NOT EXISTS music_pref text,
  ADD COLUMN IF NOT EXISTS fav_food text,
  ADD COLUMN IF NOT EXISTS fav_drink text;
