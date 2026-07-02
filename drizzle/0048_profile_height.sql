-- 0048: tinggi badan dalam cm (opsional).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS height_cm integer;
