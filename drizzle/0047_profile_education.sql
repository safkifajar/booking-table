-- 0047: pendidikan terakhir (opsional) — mis. 'bachelor'.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS education text;
