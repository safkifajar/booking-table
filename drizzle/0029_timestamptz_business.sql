-- 0029: Ubah kolom waktu bisnis dari `timestamp without time zone` → `timestamptz`.
--
-- AKAR BUG: kolom without-tz + Drizzle mode:"date" + proses Node non-UTC bikin
-- round-trip tergeser (write 14:00Z → simpan wall "21:00" → read jadi 07:00Z).
-- Slot picker (instant benar) vs booked (tergeser) tak match → slot booked
-- tampil "Tersedia".
--
-- Data existing (without-tz) menyimpan KOMPONEN UTC dari instant yg ditulis
-- (mis. instant 14:00Z disimpan sbg teks "14:00"). USING (col AT TIME ZONE
-- 'UTC') menafsir teks itu sbg UTC → timestamptz instant yg SAMA (14:00Z),
-- jadi data lama TIDAK bergeser. Setelah ini kolom timestamptz menyimpan
-- instant unambiguous, kebal TZ proses pembaca (write & read konsisten).
--
-- Cakupan: sesi/order/booking/story/banner. auth.* TIDAK diubah.

-- table_sessions
ALTER TABLE table_sessions
  ALTER COLUMN reservation_at TYPE timestamptz USING (reservation_at AT TIME ZONE 'UTC'),
  ALTER COLUMN reservation_end_at TYPE timestamptz USING (reservation_end_at AT TIME ZONE 'UTC'),
  ALTER COLUMN started_at TYPE timestamptz USING (started_at AT TIME ZONE 'UTC'),
  ALTER COLUMN closed_at TYPE timestamptz USING (closed_at AT TIME ZONE 'UTC'),
  ALTER COLUMN dp_paid_at TYPE timestamptz USING (dp_paid_at AT TIME ZONE 'UTC'),
  ALTER COLUMN created_at TYPE timestamptz USING (created_at AT TIME ZONE 'UTC');

-- session_members
ALTER TABLE session_members
  ALTER COLUMN joined_at TYPE timestamptz USING (joined_at AT TIME ZONE 'UTC'),
  ALTER COLUMN left_at TYPE timestamptz USING (left_at AT TIME ZONE 'UTC');

-- session_invites
ALTER TABLE session_invites
  ALTER COLUMN expires_at TYPE timestamptz USING (expires_at AT TIME ZONE 'UTC'),
  ALTER COLUMN created_at TYPE timestamptz USING (created_at AT TIME ZONE 'UTC');

-- orders
ALTER TABLE orders
  ALTER COLUMN closed_at TYPE timestamptz USING (closed_at AT TIME ZONE 'UTC'),
  ALTER COLUMN created_at TYPE timestamptz USING (created_at AT TIME ZONE 'UTC');

-- order_items
ALTER TABLE order_items
  ALTER COLUMN served_at TYPE timestamptz USING (served_at AT TIME ZONE 'UTC'),
  ALTER COLUMN created_at TYPE timestamptz USING (created_at AT TIME ZONE 'UTC');

-- payments
ALTER TABLE payments
  ALTER COLUMN paid_at TYPE timestamptz USING (paid_at AT TIME ZONE 'UTC'),
  ALTER COLUMN created_at TYPE timestamptz USING (created_at AT TIME ZONE 'UTC');

-- stories
ALTER TABLE stories
  ALTER COLUMN created_at TYPE timestamptz USING (created_at AT TIME ZONE 'UTC'),
  ALTER COLUMN expires_at TYPE timestamptz USING (expires_at AT TIME ZONE 'UTC');

-- story_views
ALTER TABLE story_views
  ALTER COLUMN viewed_at TYPE timestamptz USING (viewed_at AT TIME ZONE 'UTC');

-- bar_banners
ALTER TABLE bar_banners
  ALTER COLUMN starts_at TYPE timestamptz USING (starts_at AT TIME ZONE 'UTC'),
  ALTER COLUMN ends_at TYPE timestamptz USING (ends_at AT TIME ZONE 'UTC'),
  ALTER COLUMN created_at TYPE timestamptz USING (created_at AT TIME ZONE 'UTC');
