-- 0034: tambah jenis kelamin & ketertarikan (gender preference) di profil.
-- Opsional (nullable). gender: 'male'|'female'. interested_in: 'male'|'female'|'both'.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS interested_in text;
