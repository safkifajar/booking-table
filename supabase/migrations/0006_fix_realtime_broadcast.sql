-- ============================================================
-- FIX: Realtime broadcast tidak sampai ke subscriber
--
-- Penyebab: RLS member_read pakai is_session_member() helper yang
-- jalan dengan auth.uid(). Saat realtime evaluate policy untuk
-- broadcast event, context-nya kadang tidak match.
--
-- Solusi: relax policy untuk session_members SELECT — siapa saja
-- authenticated yang punya akses ke session-nya bisa lihat member-nya.
-- Akses ke session sudah diatur di policy table_sessions.
-- ============================================================

-- Drop existing read policy
drop policy if exists "members_read" on session_members;

-- New policy: bisa baca member kalau bisa baca session-nya
-- (memanfaatkan policy sessions_read yang sudah ada).
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
          or exists (
            select 1 from session_invites si
            where si.session_id = ts.id
              and si.expires_at > now()
          )
        )
    )
  );

-- Same approach for order_items: bisa baca kalau bisa baca order/session
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
        )
    )
  );

-- Same for payments
drop policy if exists "payments_read" on payments;

create policy "payments_read"
  on payments for select
  using (
    exists (
      select 1 from orders o
      join table_sessions ts on ts.id = o.session_id
      where o.id = payments.order_id
        and (
          ts.visibility = 'public'
          or ts.host_id = auth.uid()
          or is_session_member(ts.id, auth.uid())
        )
    )
  );

-- Same for orders
drop policy if exists "orders_read" on orders;

create policy "orders_read"
  on orders for select
  using (
    exists (
      select 1 from table_sessions ts
      where ts.id = orders.session_id
        and (
          ts.visibility = 'public'
          or ts.host_id = auth.uid()
          or is_session_member(ts.id, auth.uid())
        )
    )
  );
