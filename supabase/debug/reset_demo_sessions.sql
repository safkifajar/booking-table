-- ============================================================
-- CLEANUP: hapus semua demo data dari 0008_demo_seed_sessions.sql
--
-- Urutan delete penting karena beberapa FK pakai 'restrict' (bukan cascade):
--   table_sessions.host_id → profiles  (restrict)
--   session_members.profile_id → profiles  (cascade)
--   order_items.added_by_member_id → session_members  (restrict)
--   payments.paid_by_member_id → session_members  (restrict)
-- ============================================================

do $$
declare
  v_user_ids uuid[];
  v_session_ids uuid[];
begin
  -- Ambil semua demo user IDs
  select array_agg(id) into v_user_ids
  from auth.users
  where email like '%.demo@soho.id';

  if v_user_ids is null or array_length(v_user_ids, 1) = 0 then
    raise notice 'No demo users found, nothing to clean';
    return;
  end if;

  -- Ambil semua session yang dimiliki demo user
  select array_agg(id) into v_session_ids
  from table_sessions
  where host_id = any(v_user_ids);

  if v_session_ids is not null then
    -- Delete dengan urutan child → parent
    delete from payments where order_id in (
      select id from orders where session_id = any(v_session_ids)
    );
    delete from order_items where order_id in (
      select id from orders where session_id = any(v_session_ids)
    );
    delete from orders where session_id = any(v_session_ids);
    delete from session_invites where session_id = any(v_session_ids);
    delete from member_ratings where session_id = any(v_session_ids);
    delete from session_members where session_id = any(v_session_ids);
    delete from table_sessions where id = any(v_session_ids);
  end if;

  -- Sekarang aman delete users (cascade ke profiles)
  delete from auth.users where id = any(v_user_ids);

  raise notice 'Cleaned % demo users and % sessions',
    array_length(v_user_ids, 1),
    coalesce(array_length(v_session_ids, 1), 0);
end;
$$;

-- Verifikasi sisa data
select 'remaining demo users' as info, count(*) as count
from auth.users where email like '%.demo@soho.id'
union all
select 'remaining active sessions', count(*)
from table_sessions where status in ('open', 'locked');
