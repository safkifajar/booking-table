-- ============================================================
-- FIX: Realtime events tidak terkirim karena RLS evaluation
--
-- Supabase Realtime perlu:
-- 1. Replica identity FULL agar WHERE filter di policy bisa dievaluasi
--    untuk row yang baru di-insert/update/delete.
-- 2. Policy yang bisa di-evaluate tanpa context request user.
-- ============================================================

-- Set replica identity FULL untuk tables yang di-listen via realtime
alter table session_members replica identity full;
alter table table_sessions replica identity full;
alter table order_items replica identity full;
alter table payments replica identity full;
alter table orders replica identity full;
