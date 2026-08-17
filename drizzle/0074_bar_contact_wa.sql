-- 0074: nomor WhatsApp CS bisa diatur dari admin (tak lagi hardcode/env).
--
-- pre-migrate  <- penanda: dijalankan scripts/pre-migrate.sh SEBELUM db:push.
--
-- bars.contact_wa — format 62... tanpa +/spasi (sesuai wa.me).
-- NULL/kosong = jatuh balik ke default lib/contact.ts (env
-- NEXT_PUBLIC_CONTACT_WA atau nomor bawaan), jadi perilaku lama tetap jalan
-- sampai admin mengisinya.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS.
--
-- ROLLBACK: ALTER TABLE bars DROP COLUMN IF EXISTS contact_wa;

ALTER TABLE bars
  ADD COLUMN IF NOT EXISTS contact_wa text;
