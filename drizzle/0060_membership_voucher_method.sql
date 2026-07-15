-- 0060: nilai enum payment_method 'voucher' (PRD Membership rev-2).
--
-- pre-migrate  <- penanda: dijalankan scripts/pre-migrate.sh SEBELUM db:push.
--
-- Potongan voucher membership dicatat sebagai baris payments dengan
-- method='voucher' (status paid) supaya outstanding bill tertutup benar dan
-- laporan melihat diskonnya. Enum payment_method sudah ada di production,
-- jadi ADD VALUE wajib lewat pre-migrate (pola 0058).
--
-- Tabel membership (levels/vouchers/transactions/member_vouchers) TIDAK
-- butuh migrasi di sini — belum pernah di-deploy; db:push membuatnya fresh.
--
-- IDEMPOTENT: ADD VALUE IF NOT EXISTS -> aman dijalankan berulang.

ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'voucher';
