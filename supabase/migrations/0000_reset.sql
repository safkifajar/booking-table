-- ============================================================
-- RESET SCRIPT — hapus semua table & type dari project lama
-- Jalankan SEKALI di Supabase SQL Editor sebelum migration utama.
-- HATI-HATI: ini menghapus SEMUA table di schema 'public'.
-- ============================================================

do $$
declare
  r record;
begin
  -- drop all tables in public schema (cascade)
  for r in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('drop table if exists public.%I cascade', r.tablename);
  end loop;

  -- drop all enums in public schema
  for r in
    select t.typname
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype = 'e'
  loop
    execute format('drop type if exists public.%I cascade', r.typname);
  end loop;

  -- drop all functions in public schema
  for r in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('drop function if exists public.%I(%s) cascade', r.proname, r.args);
  end loop;

  -- drop all views in public schema
  for r in
    select viewname from pg_views where schemaname = 'public'
  loop
    execute format('drop view if exists public.%I cascade', r.viewname);
  end loop;
end $$;
