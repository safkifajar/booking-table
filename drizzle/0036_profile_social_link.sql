-- 0036: link media sosial bebas di profil (opsional).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS social_link text;
