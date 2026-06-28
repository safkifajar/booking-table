-- 0039: flag onboarding selesai. Default false utk akun BARU (paksa wizard),
-- tapi semua akun EXISTING di-set true supaya tak terkena gate onboarding.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS onboarded boolean NOT NULL DEFAULT false;

-- Akun lama dianggap sudah onboarded.
UPDATE profiles SET onboarded = true;
