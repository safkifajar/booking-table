-- =====================================================================
-- Tipe notif pembayaran
--
-- payment_received  : pembayaran QRIS berhasil (lunas). Juga dipakai untuk
--                     konfirmasi DP booking (wording beda di title/body).
-- payment_cancelled : pembayaran gagal / kadaluarsa (QRIS expired/dibatalkan).
--
-- Dikirim ke host + pembayar + staff aktif bar. Ditangani createNotification
-- (in-app SSE + web push).
-- =====================================================================

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'payment_received';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'payment_cancelled';
