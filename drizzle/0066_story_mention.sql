-- 0066: nilai enum notifikasi 'story_mention' untuk fitur mention @user di story.
--
-- pre-migrate  <- penanda: dijalankan scripts/pre-migrate.sh SEBELUM db:push.
--                ALTER TYPE ... ADD VALUE mengikuti pola 0058. ADD VALUE tak
--                boleh berada dalam blok transaksi bersama pemakaian nilainya,
--                jadi dijalankan lebih dulu (pre-migrate) & terpisah.
--
-- Kolom stories.mentions (uuid[]) untuk menyimpan profil yang di-tag dibuat
-- oleh db:push (non-destruktif) bersama migrasi 0065.
--
-- IDEMPOTENT: ADD VALUE IF NOT EXISTS -> aman dijalankan berulang.

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'story_mention';
