-- =====================================================================
-- Notifikasi in-app + kolom invited_by (fitur ajak/undang user)
--
-- 1. notifications: notif per-user (in-app), dipush realtime via
--    Postgres NOTIFY channel "user:<profileId>".
-- 2. session_members.invited_by: bedakan UNDANGAN dari host (invited_by
--    terisi → user yg approve) vs REQUEST-JOIN biasa (invited_by NULL →
--    host yg approve).
-- =====================================================================

-- 1. Enum tipe notifikasi
DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM (
    'table_joined', 'table_invite', 'invite_accepted', 'general'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 2. Tabel notifications
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type notification_type NOT NULL DEFAULT 'general',
  title text NOT NULL,
  body text,
  link text,
  read_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

-- Query "notif user X, unread dulu / terbaru" cepat.
CREATE INDEX IF NOT EXISTS idx_notifications_profile
  ON notifications(profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications(profile_id)
  WHERE read_at IS NULL;

-- 3. session_members.invited_by
ALTER TABLE session_members
  ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN session_members.invited_by IS
  'Host yg mengundang (invite_only). Terisi = undangan (user yg approve). NULL + pending = request-join (host yg approve).';
