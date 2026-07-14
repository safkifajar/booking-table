-- 0058: nilai enum notifikasi untuk fitur Friends (PRD Friends 4.4).
--
-- pre-migrate  <- penanda: dijalankan scripts/pre-migrate.sh SEBELUM db:push.
--                ALTER TYPE ... ADD VALUE mengikuti pola 0054/0056.
--
-- Tabel baru (friend_requests, friendships, user_blocks), enum
-- friend_request_status, dan kolom notifications.ref_id dibuat oleh db:push
-- (non-destruktif) — tidak perlu SQL manual di sini.
--
-- IDEMPOTENT: ADD VALUE IF NOT EXISTS -> aman dijalankan berulang.

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'friend_request';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'friend_accepted';
