-- 0033: cegah double-booking secara fisik di level DB (anti race condition).
--
-- Masalah: openTable/staffOpenTableForCustomer cek-bentrok lalu insert (check-
-- then-act). Dua request paralel utk meja+waktu sama bisa sama-sama lolos cek
-- sebelum salah satu insert → double booking. Transaction saja tak mencegah ini.
--
-- Solusi: EXCLUDE constraint. PostgreSQL menolak dua sesi dgn rentang waktu
-- (reservation_at..reservation_end_at) yg TUMPANG-TINDIH pada meja (table_id)
-- yang sama. Berlaku utk sesi berentang-waktu yg masih relevan:
-- reserved / open / locked. Walk-in tanpa rentang waktu (reservation_at NULL)
-- tidak terkena — itu sudah dijaga uq_active_session_per_table (1 aktif/meja).
--
-- Range half-open [start, end): booking 19:00–21:00 & 21:00–23:00 TIDAK overlap
-- (jam 21:00 milik booking kedua). Sesuai perilaku slot picker.

-- btree_gist: supaya bisa pakai operator '=' (table_id) bareng '&&' (range) di GiST.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE table_sessions
  ADD CONSTRAINT no_overlapping_reservation
  EXCLUDE USING gist (
    table_id WITH =,
    tstzrange(reservation_at, reservation_end_at, '[)') WITH &&
  )
  WHERE (
    status IN ('reserved', 'open', 'locked')
    AND reservation_at IS NOT NULL
    AND reservation_end_at IS NOT NULL
  );
