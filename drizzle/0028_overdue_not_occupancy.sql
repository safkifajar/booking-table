-- =====================================================================
-- overdue BUKAN okupansi fisik
--
-- Sesi 'overdue' = lewat waktu, cuma nunggak bayar — orangnya sudah pergi,
-- meja FISIK kosong. Sebelumnya overdue ikut di unique index okupansi
-- (uq_active_session_per_table), sehingga reservasi baru tak bisa jadi 'open'
-- di meja yg punya overdue lama → meja "terkunci". Lepaskan overdue dari index
-- supaya 1 meja boleh punya overdue (hutang lama) + open (tamu baru) sekaligus.
-- Hutang tetap tertagih (data sesi overdue tetap ada; muncul di kasir/banner).
-- =====================================================================

DROP INDEX IF EXISTS uq_active_session_per_table;
CREATE UNIQUE INDEX uq_active_session_per_table
  ON table_sessions (table_id)
  WHERE status IN ('open', 'locked');
