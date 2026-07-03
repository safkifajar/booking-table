-- 0050: emoji untuk master hobi (ditampilkan di onboarding/profil).
ALTER TABLE hobbies
  ADD COLUMN IF NOT EXISTS emoji text;
