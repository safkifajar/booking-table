-- ============================================================
-- FIX: Infinite recursion in RLS policies
-- Penyebab: policy session_members.read self-reference subquery
-- Solusi: helper function SECURITY DEFINER untuk bypass RLS
-- ============================================================

-- Helper: cek apakah user ini adalah member dari session (bypass RLS)
create or replace function is_session_member(p_session_id uuid, p_profile_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from session_members
    where session_id = p_session_id and profile_id = p_profile_id
  );
$$;

-- Helper: cek apakah user adalah host session (bypass RLS)
create or replace function is_session_host(p_session_id uuid, p_profile_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from table_sessions
    where id = p_session_id and host_id = p_profile_id
  );
$$;

-- Helper: cek apakah ini member yang valid dari order
create or replace function is_member_of_order(p_order_id uuid, p_profile_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from orders o
    join session_members sm on sm.session_id = o.session_id
    where o.id = p_order_id and sm.profile_id = p_profile_id
  );
$$;

-- Grant execute (RLS still applies on caller's queries, these just bypass for the lookups)
grant execute on function is_session_member(uuid, uuid) to authenticated, anon;
grant execute on function is_session_host(uuid, uuid) to authenticated, anon;
grant execute on function is_member_of_order(uuid, uuid) to authenticated, anon;

-- ============================================================
-- DROP existing policies that cause recursion
-- ============================================================

drop policy if exists "members_read_by_session_members" on session_members;
drop policy if exists "members_update_host_or_self" on session_members;
drop policy if exists "sessions_read_public" on table_sessions;
drop policy if exists "invites_read_session_members" on session_invites;
drop policy if exists "invites_insert_session_member" on session_invites;
drop policy if exists "orders_read_member" on orders;
drop policy if exists "orders_insert_member" on orders;
drop policy if exists "orders_update_member" on orders;
drop policy if exists "order_items_read_member" on order_items;
drop policy if exists "order_items_update_member" on order_items;
drop policy if exists "payments_read_member" on payments;

-- ============================================================
-- RECREATE policies using helper functions
-- ============================================================

-- SESSION MEMBERS
create policy "members_read"
  on session_members for select
  using (
    profile_id = auth.uid()
    or is_session_member(session_id, auth.uid())
    or is_session_host(session_id, auth.uid())
  );

create policy "members_update"
  on session_members for update
  using (
    profile_id = auth.uid()
    or is_session_host(session_id, auth.uid())
  );

-- TABLE SESSIONS
create policy "sessions_read"
  on table_sessions for select
  using (
    visibility = 'public'
    or host_id = auth.uid()
    or is_session_member(id, auth.uid())
  );

-- SESSION INVITES
create policy "invites_read"
  on session_invites for select
  using (
    created_by = auth.uid()
    or is_session_member(session_id, auth.uid())
  );

create policy "invites_insert"
  on session_invites for insert
  with check (
    created_by = auth.uid()
    and is_session_member(session_id, auth.uid())
  );

-- ORDERS
create policy "orders_read"
  on orders for select
  using (is_session_member(session_id, auth.uid()));

create policy "orders_insert"
  on orders for insert
  with check (is_session_member(session_id, auth.uid()));

create policy "orders_update"
  on orders for update
  using (is_session_member(session_id, auth.uid()));

-- ORDER ITEMS
create policy "order_items_read"
  on order_items for select
  using (is_member_of_order(order_id, auth.uid()));

create policy "order_items_update"
  on order_items for update
  using (is_member_of_order(order_id, auth.uid()));

-- PAYMENTS
create policy "payments_read"
  on payments for select
  using (is_member_of_order(order_id, auth.uid()));
