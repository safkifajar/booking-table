-- 0075: catatan pengiriman email (Admin → System → Email Log).
--
-- pre-migrate  <- penanda: dijalankan scripts/pre-migrate.sh SEBELUM db:push.
--                CREATE TABLE + index dibuat lebih dulu supaya db:push
--                melihat skema sudah sinkron (tanpa prompt interaktif).
--
-- Ada supaya keluhan "email saya tak sampai" bisa ditelusuri: tanpa ini kita
-- cuma bisa menebak apakah emailnya benar-benar dikirim, ditolak penyedia,
-- atau memang tak pernah diminta.
--
-- Tabel ini TUMBUH terus, jadi dibersihkan otomatis setelah 90 hari lewat
-- purgeOldEmailLogs() yang menumpang cron yang sudah ada.
--
-- IDEMPOTENT: CREATE TABLE/INDEX IF NOT EXISTS.
--
-- ROLLBACK: DROP TABLE IF EXISTS email_logs;

CREATE TABLE IF NOT EXISTS email_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient           text NOT NULL,
  subject             text NOT NULL,
  kind                text NOT NULL DEFAULT 'other',
  status              text NOT NULL,
  provider            text NOT NULL,
  provider_message_id text,
  error               text,
  body_html           text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Halaman log: terbaru dulu.
CREATE INDEX IF NOT EXISTS idx_email_logs_created
  ON email_logs (created_at);

-- Pencarian per penerima — pertanyaan tersering saat menelusuri keluhan.
CREATE INDEX IF NOT EXISTS idx_email_logs_recipient
  ON email_logs (recipient);

-- Penyaringan "tampilkan yang gagal saja".
CREATE INDEX IF NOT EXISTS idx_email_logs_status
  ON email_logs (status, created_at);
