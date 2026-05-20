-- ============================================================
-- STAFF DASHBOARD: helper functions + RLS extension
--
-- Tujuan:
-- 1. Function is_staff() untuk cek apakah user adalah staff aktif.
-- 2. Extend RLS order_items.update agar staff bisa ubah status
--    (sent → preparing → served) tanpa harus jadi member meja.
-- 3. Extend RLS table_sessions.read agar staff bisa lihat semua session
--    aktif (bukan cuma yang dia jadi member-nya).
-- 4. Extend RLS order_items.read & members.read untuk staff.
-- ============================================================

-- Helper: cek apakah user adalah staff aktif (waiter/manager/admin)
create or replace function is_staff(p_profile_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from staff_roles
    where profile_id = p_profile_id
      and is_active = true
  );
$$;

create or replace function is_staff_in_bar(p_profile_id uuid, p_bar_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from staff_roles
    where profile_id = p_profile_id
      and bar_id = p_bar_id
      and is_active = true
  );
$$;

grant execute on function is_staff(uuid) to authenticated;
grant execute on function is_staff_in_bar(uuid, uuid) to authenticated;

-- ============================================================
-- EXTEND RLS — staff bisa lihat & update lebih
-- ============================================================

-- TABLE SESSIONS: staff bisa lihat semua session di bar mereka
drop policy if exists "sessions_read" on table_sessions;
create policy "sessions_read"
  on table_sessions for select
  using (
    visibility = 'public'
    or host_id = auth.uid()
    or is_session_member(id, auth.uid())
    or is_staff(auth.uid())
    or exists (
      select 1 from session_invites si
      where si.session_id = table_sessions.id
        and si.expires_at > now()
    )
  );

-- SESSION MEMBERS: staff bisa lihat
drop policy if exists "members_read" on session_members;
create policy "members_read"
  on session_members for select
  using (
    exists (
      select 1 from table_sessions ts
      where ts.id = session_members.session_id
        and (
          ts.visibility = 'public'
          or ts.host_id = auth.uid()
          or is_session_member(ts.id, auth.uid())
          or is_staff(auth.uid())
          or exists (
            select 1 from session_invites si
            where si.session_id = ts.id
              and si.expires_at > now()
          )
        )
    )
  );

-- ORDERS: staff bisa lihat & update
drop policy if exists "orders_read" on orders;
create policy "orders_read"
  on orders for select
  using (
    is_session_member(session_id, auth.uid())
    or is_staff(auth.uid())
  );

drop policy if exists "orders_update" on orders;
create policy "orders_update"
  on orders for update
  using (
    is_session_member(session_id, auth.uid())
    or is_staff(auth.uid())
  );

-- ORDER ITEMS: staff bisa lihat & update status
drop policy if exists "order_items_read" on order_items;
create policy "order_items_read"
  on order_items for select
  using (
    exists (
      select 1 from orders o
      join table_sessions ts on ts.id = o.session_id
      where o.id = order_items.order_id
        and (
          ts.visibility = 'public'
          or ts.host_id = auth.uid()
          or is_session_member(ts.id, auth.uid())
          or is_staff(auth.uid())
        )
    )
  );

drop policy if exists "order_items_update" on order_items;
create policy "order_items_update"
  on order_items for update
  using (
    exists (
      select 1 from orders o
      join table_sessions ts on ts.id = o.session_id
      where o.id = order_items.order_id
        and (
          is_session_member(ts.id, auth.uid())
          or is_staff(auth.uid())
        )
    )
  );

-- PAYMENTS: staff bisa lihat (untuk dashboard omzet nanti)
drop policy if exists "payments_read" on payments;
create policy "payments_read"
  on payments for select
  using (
    exists (
      select 1 from orders o
      join table_sessions ts on ts.id = o.session_id
      where o.id = payments.order_id
        and (
          is_session_member(ts.id, auth.uid())
          or is_staff(auth.uid())
        )
    )
  );

-- STAFF ROLES: self read sudah ada di 0001
-- Tambah: staff insert/delete hanya admin, untuk sekarang skip (admin dashboard)
