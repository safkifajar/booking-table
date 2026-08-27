-- Hapus SATU transaksi membership.
--
-- Dipakai membersihkan transaksi uji coba yang gagal — mis. yang tak pernah
-- menghasilkan QRIS karena PAYMENT_GATEWAY production masih 'mock'.
--
-- CARA PAKAI (di VPS):
--   cd /home/booking/soho-prod
--   DB_URL="$(grep -E '^DATABASE_URL=' .env.local | cut -d= -f2-)"
--   psql "$DB_URL" -v tx="'eb75b31c-64d5-453a-b789-d89234750da1'" \
--        -f scripts/delete-membership-tx.sql
--
-- `tx` = id transaksi PENUH (ada di URL halaman detailnya), dalam kutip
-- tunggal.
--
-- YANG DIPERIKSA LEBIH DULU — dan kenapa penting:
-- Transaksi berstatus lunas biasanya SUDAH menaikkan level membership tamu
-- (profiles.membership_level + membership_expires_at). Menghapus transaksinya
-- saja meninggalkan tamu dengan membership berbayar TANPA jejak
-- pembayarannya. Skrip ini menampilkan level tamu sebelum & sesudah supaya
-- keputusan itu diambil sadar, bukan tak sengaja.
--
-- Seluruhnya dalam SATU transaksi DB — kalau ada langkah gagal, tak ada yang
-- terhapus setengah jalan.

BEGIN;

\echo ''
\echo '=== TRANSAKSI YANG AKAN DIHAPUS ==='
SELECT
  left(mt.id::text, 8)  AS ref,
  mt.level_key,
  mt.kind,
  mt.status,
  mt.method,
  mt.amount,
  mt.external_ref,
  mt.paid_at,
  mt.created_at
FROM membership_transactions mt
WHERE mt.id = :tx::uuid;

\echo ''
\echo '=== PEMILIKNYA & LEVEL MEMBERSHIP SEKARANG ==='
\echo '(kalau status transaksi di atas "paid" TAPI level di bawah masih naik,'
\echo ' turunkan manual setelah ini — lihat catatan di akhir berkas)'
SELECT
  p.display_name,
  p.username,
  p.membership_level,
  p.membership_expires_at
FROM profiles p
WHERE p.id = (SELECT profile_id FROM membership_transactions WHERE id = :tx::uuid);

\echo ''
\echo '=== VOUCHER YANG TAUTANNYA AKAN DILEPAS (voucher TIDAK dihapus) ==='
SELECT count(*) AS jumlah_voucher
FROM member_vouchers
WHERE membership_tx_id = :tx::uuid;

-- ============================================================
-- PENGHAPUSAN
-- ============================================================
-- member_vouchers.membership_tx_id memakai ON DELETE SET NULL, jadi voucher
-- yang sudah dimiliki tamu tetap ada — cuma kehilangan tautan ke transaksi
-- ini. Itu memang yang diinginkan: mencabut voucher yang sudah diberikan
-- adalah keputusan terpisah.

DELETE FROM membership_transactions WHERE id = :tx::uuid;

\echo ''
\echo '=== SISA (harus 0) ==='
SELECT count(*) AS sisa FROM membership_transactions WHERE id = :tx::uuid;

COMMIT;

\echo ''
\echo 'Selesai.'
\echo ''
\echo 'CATATAN: kalau transaksi tadi berstatus "paid" & sudah menaikkan level'
\echo 'tamu, level itu TIDAK ikut turun. Turunkan manual bila perlu:'
\echo ''
\echo '  UPDATE profiles SET membership_level = ''basic'','
\echo '         membership_expires_at = NULL'
\echo '  WHERE id = ''<profile_id dari tabel di atas>'';'
