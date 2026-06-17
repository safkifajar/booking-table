-- =====================================================================
-- Tipe notif 'invite_cancelled'
--
-- Saat host membatalkan undangan yang belum dijawab, notif undangan lama
-- (table_invite) milik penerima diubah jadi 'invite_cancelled': tombol
-- Terima/Tolak hilang, label jadi "Undangan dibatalkan", muncul sbg unread.
-- =====================================================================

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'invite_cancelled';
