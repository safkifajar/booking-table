-- =====================================================================
-- Notif "undangan ditolak" + kolom responded_at
--
-- 1. notification_type: tambah nilai 'invite_rejected' (notif ke pengundang
--    saat undangannya ditolak — counterpart 'invite_accepted').
-- 2. notifications.responded_at: timestamp saat notif undangan (table_invite)
--    SUDAH direspon (terima/tolak). NULL = belum direspon → tombol Terima/Tolak
--    masih muncul. Terisi = sudah → tombol diganti label status.
-- =====================================================================

-- 1. Tambah nilai enum. ADD VALUE tidak boleh di dalam transaksi yg juga
--    memakai nilainya; di sini cuma menambah, aman. IF NOT EXISTS supaya
--    idempotent kalau migration dijalankan ulang.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'invite_rejected';

-- 2. Kolom responded_at
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS responded_at timestamp;

COMMENT ON COLUMN notifications.responded_at IS
  'Saat notif undangan (table_invite) direspon (terima/tolak). NULL = belum direspon → tombol aksi masih tampil.';
