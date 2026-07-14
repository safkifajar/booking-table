-- 0057: hapus tabel session_invites (fitur invite-link dihapus, PRD Friends K7).
--
-- pre-migrate  <- penanda: dijalankan scripts/pre-migrate.sh SEBELUM db:push.
--                Kalau drop diserahkan ke `db:push --force`, penghapusan tabel
--                berisi data bisa memunculkan prompt interaktif yang
--                menggantung CI (pelajaran dari kasus unique constraint username).
--
-- Alasan penghapusan:
-- 1. Fitur SUDAH MATI di UI — kode invite tak pernah ditampilkan/dibagikan
--    ke siapa pun (tak ada tombol share/copy, tak ada link ke /join/).
-- 2. joinByCode adalah BYPASS TOTAL untuk aturan meja "friends" (PRD K3).
-- 3. createInvite tak punya guard host — siapa pun yang login bisa membuat
--    kode untuk session mana pun (lubang keamanan existing).
--
-- IDEMPOTENT: DROP TABLE IF EXISTS -> aman dijalankan berulang.

DROP TABLE IF EXISTS session_invites;
