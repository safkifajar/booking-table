-- ============================================================
-- DEBUG: Reset semua active session (untuk fresh demo)
-- Hapus session, member, order, payment yang aktif.
-- TIDAK hapus bar/area/table/menu (master data tetap).
-- TIDAK hapus profile/auth user.
-- ============================================================

-- 1. Hapus payments dulu (anak terakhir)
delete from payments
where order_id in (
  select id from orders
  where session_id in (
    select id from table_sessions
    where status in ('open', 'locked')
  )
);

-- 2. Hapus order_items
delete from order_items
where order_id in (
  select id from orders
  where session_id in (
    select id from table_sessions
    where status in ('open', 'locked')
  )
);

-- 3. Hapus orders
delete from orders
where session_id in (
  select id from table_sessions
  where status in ('open', 'locked')
);

-- 4. Hapus invites
delete from session_invites
where session_id in (
  select id from table_sessions
  where status in ('open', 'locked')
);

-- 5. Hapus members
delete from session_members
where session_id in (
  select id from table_sessions
  where status in ('open', 'locked')
);

-- 6. Hapus ratings (kalau ada)
delete from member_ratings
where session_id in (
  select id from table_sessions
  where status in ('open', 'locked')
);

-- 7. Hapus sessions
delete from table_sessions
where status in ('open', 'locked');

-- Verifikasi
select 'active sessions remaining:' as info, count(*) as count
from table_sessions
where status in ('open', 'locked');
