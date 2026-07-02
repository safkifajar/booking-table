-- 0049: agama (opsional) — mis. 'islam'.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS religion text;
