-- 0046: prompt profil (ice-breaker) — [{ prompt, answer }], maks 5.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS prompts jsonb NOT NULL DEFAULT '[]'::jsonb;
