-- ============================================================
-- FIX: Security Definer Views
--
-- Supabase Advisor warning: views public.v_active_sessions,
-- public.v_session_bill, public.v_user_rating_summary defined
-- with SECURITY DEFINER property (default Postgres behavior).
--
-- Fix: set security_invoker=true → view applies RLS from caller,
-- not from view owner.
-- ============================================================

alter view public.v_active_sessions
  set (security_invoker = true);

alter view public.v_session_bill
  set (security_invoker = true);

alter view public.v_user_rating_summary
  set (security_invoker = true);

-- Verifikasi
select
  schemaname,
  viewname,
  viewowner,
  (
    select string_agg(opt, ', ')
    from unnest(c.reloptions) as opt
  ) as options
from pg_views v
join pg_class c on c.relname = v.viewname
where v.schemaname = 'public'
  and v.viewname in ('v_active_sessions', 'v_session_bill', 'v_user_rating_summary');
