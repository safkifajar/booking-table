-- ============================================================
-- Add hobbies to profiles
--
-- Multi-tag (text array). Default empty, jadi user lama tidak break.
-- ============================================================

alter table profiles
  add column if not exists hobbies text[] not null default '{}';

-- Index GIN untuk search/filter di kemudian hari (optional, tapi tidak mahal)
create index if not exists idx_profiles_hobbies
  on profiles using gin (hobbies);
