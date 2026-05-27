-- ============================================================
-- ADMIN REPORTS — RPC aggregate functions
--
-- Semua RPC pakai timezone Asia/Jakarta untuk grouping by hour/day.
-- Periode di-pass sebagai timestamp range [from, to).
-- Closed sessions saja (status = 'closed') untuk hasil yang final.
-- ============================================================

-- ============================================================
-- 1. SUMMARY: total omzet, transaksi, pengunjung, avg bill
-- ============================================================
create or replace function admin_sales_summary(
  p_bar_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  total_revenue bigint,
  transaction_count int,
  unique_visitors int,
  avg_bill bigint,
  total_items int,
  avg_items_per_transaction numeric
)
language sql
security invoker
stable
set search_path = public
as $$
  with sessions_in_range as (
    select ts.id, ts.host_id
    from table_sessions ts
    join tables t on t.id = ts.table_id
    join floor_areas fa on fa.id = t.area_id
    where fa.bar_id = p_bar_id
      and ts.status = 'closed'
      and ts.closed_at >= p_from
      and ts.closed_at < p_to
  ),
  bills as (
    select
      sr.id as session_id,
      coalesce(sum(oi.quantity * oi.unit_price), 0)::bigint as bill_total,
      count(oi.id)::int as item_count
    from sessions_in_range sr
    left join orders o on o.session_id = sr.id
    left join order_items oi on oi.order_id = o.id and oi.status <> 'void'
    group by sr.id
  ),
  visitors as (
    select count(distinct sm.profile_id)::int as cnt
    from sessions_in_range sr
    join session_members sm on sm.session_id = sr.id
    where sm.status in ('joined', 'left')
  )
  select
    coalesce(sum(b.bill_total), 0)::bigint as total_revenue,
    count(b.session_id)::int as transaction_count,
    (select cnt from visitors) as unique_visitors,
    case
      when count(b.session_id) > 0 then (sum(b.bill_total) / count(b.session_id))::bigint
      else 0
    end as avg_bill,
    coalesce(sum(b.item_count), 0)::int as total_items,
    case
      when count(b.session_id) > 0 then round(sum(b.item_count)::numeric / count(b.session_id), 1)
      else 0
    end as avg_items_per_transaction
  from bills b;
$$;

-- ============================================================
-- 2. TOP SELLERS: item performance dalam periode
-- ============================================================
create or replace function admin_top_items(
  p_bar_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_limit int default 20
)
returns table (
  menu_item_id uuid,
  name text,
  category_name text,
  total_qty int,
  total_revenue bigint,
  transaction_count int
)
language sql
security invoker
stable
set search_path = public
as $$
  select
    mi.id as menu_item_id,
    mi.name,
    mc.name as category_name,
    sum(oi.quantity)::int as total_qty,
    sum(oi.quantity * oi.unit_price)::bigint as total_revenue,
    count(distinct o.session_id)::int as transaction_count
  from order_items oi
  join menu_items mi on mi.id = oi.menu_item_id
  join menu_categories mc on mc.id = mi.category_id
  join orders o on o.id = oi.order_id
  join table_sessions ts on ts.id = o.session_id
  join tables t on t.id = ts.table_id
  join floor_areas fa on fa.id = t.area_id
  where fa.bar_id = p_bar_id
    and ts.status = 'closed'
    and ts.closed_at >= p_from
    and ts.closed_at < p_to
    and oi.status <> 'void'
  group by mi.id, mi.name, mc.name
  order by total_revenue desc
  limit p_limit;
$$;

-- ============================================================
-- 3. SALES BY HOUR: omzet per jam (untuk heatmap/chart)
-- ============================================================
create or replace function admin_sales_by_hour(
  p_bar_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  hour_of_day int,
  total_revenue bigint,
  transaction_count int
)
language sql
security invoker
stable
set search_path = public
as $$
  with hourly as (
    select
      extract(hour from (ts.closed_at at time zone 'Asia/Jakarta'))::int as h,
      ts.id as session_id,
      coalesce(sum(oi.quantity * oi.unit_price), 0)::bigint as bill_total
    from table_sessions ts
    join tables t on t.id = ts.table_id
    join floor_areas fa on fa.id = t.area_id
    left join orders o on o.session_id = ts.id
    left join order_items oi on oi.order_id = o.id and oi.status <> 'void'
    where fa.bar_id = p_bar_id
      and ts.status = 'closed'
      and ts.closed_at >= p_from
      and ts.closed_at < p_to
    group by ts.id, h
  )
  select
    h as hour_of_day,
    sum(bill_total)::bigint as total_revenue,
    count(session_id)::int as transaction_count
  from hourly
  group by h
  order by h;
$$;

-- ============================================================
-- 4. SALES BY DAY: omzet per tanggal
-- ============================================================
create or replace function admin_sales_by_day(
  p_bar_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  sale_date date,
  total_revenue bigint,
  transaction_count int
)
language sql
security invoker
stable
set search_path = public
as $$
  with daily as (
    select
      (ts.closed_at at time zone 'Asia/Jakarta')::date as d,
      ts.id as session_id,
      coalesce(sum(oi.quantity * oi.unit_price), 0)::bigint as bill_total
    from table_sessions ts
    join tables t on t.id = ts.table_id
    join floor_areas fa on fa.id = t.area_id
    left join orders o on o.session_id = ts.id
    left join order_items oi on oi.order_id = o.id and oi.status <> 'void'
    where fa.bar_id = p_bar_id
      and ts.status = 'closed'
      and ts.closed_at >= p_from
      and ts.closed_at < p_to
    group by ts.id, d
  )
  select
    d as sale_date,
    sum(bill_total)::bigint as total_revenue,
    count(session_id)::int as transaction_count
  from daily
  group by d
  order by d;
$$;

-- ============================================================
-- 5. PAYMENT METHOD BREAKDOWN
-- ============================================================
create or replace function admin_payment_methods(
  p_bar_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  method text,
  total_amount bigint,
  payment_count int,
  pct_share numeric
)
language sql
security invoker
stable
set search_path = public
as $$
  with paid as (
    select p.method, p.amount
    from payments p
    join orders o on o.id = p.order_id
    join table_sessions ts on ts.id = o.session_id
    join tables t on t.id = ts.table_id
    join floor_areas fa on fa.id = t.area_id
    where fa.bar_id = p_bar_id
      and ts.status = 'closed'
      and ts.closed_at >= p_from
      and ts.closed_at < p_to
      and p.status = 'paid'
  ),
  totals as (
    select coalesce(sum(amount), 0)::bigint as grand_total
    from paid
  )
  select
    method::text,
    sum(amount)::bigint as total_amount,
    count(*)::int as payment_count,
    case
      when (select grand_total from totals) > 0
        then round((sum(amount)::numeric / (select grand_total from totals)) * 100, 1)
      else 0
    end as pct_share
  from paid
  group by method
  order by total_amount desc;
$$;

-- ============================================================
-- 6. TRANSACTIONS LIST: per session closed
-- ============================================================
create or replace function admin_transactions(
  p_bar_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_limit int default 100,
  p_offset int default 0
)
returns table (
  session_id uuid,
  closed_at timestamptz,
  started_at timestamptz,
  duration_minutes int,
  table_label text,
  area_name text,
  host_name text,
  member_count int,
  item_count int,
  subtotal bigint,
  paid_total bigint,
  session_title text
)
language sql
security invoker
stable
set search_path = public
as $$
  select
    ts.id as session_id,
    ts.closed_at,
    ts.started_at,
    extract(epoch from (ts.closed_at - ts.started_at))::int / 60 as duration_minutes,
    t.label as table_label,
    fa.name as area_name,
    p.display_name as host_name,
    (select count(*) from session_members sm
      where sm.session_id = ts.id and sm.status in ('joined', 'left'))::int as member_count,
    (select count(*) from order_items oi
      join orders o on o.id = oi.order_id
      where o.session_id = ts.id and oi.status <> 'void')::int as item_count,
    (select coalesce(sum(oi.quantity * oi.unit_price), 0) from order_items oi
      join orders o on o.id = oi.order_id
      where o.session_id = ts.id and oi.status <> 'void')::bigint as subtotal,
    (select coalesce(sum(pay.amount), 0) from payments pay
      join orders o on o.id = pay.order_id
      where o.session_id = ts.id and pay.status = 'paid')::bigint as paid_total,
    ts.title as session_title
  from table_sessions ts
  join tables t on t.id = ts.table_id
  join floor_areas fa on fa.id = t.area_id
  join profiles p on p.id = ts.host_id
  where fa.bar_id = p_bar_id
    and ts.status = 'closed'
    and ts.closed_at >= p_from
    and ts.closed_at < p_to
  order by ts.closed_at desc
  limit p_limit offset p_offset;
$$;

-- ============================================================
-- GRANTS — semua RPC bisa di-call authenticated user.
-- Filter akses ke admin/manager via app-level check (requireAdmin)
-- ============================================================
grant execute on function admin_sales_summary(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function admin_top_items(uuid, timestamptz, timestamptz, int) to authenticated;
grant execute on function admin_sales_by_hour(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function admin_sales_by_day(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function admin_payment_methods(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function admin_transactions(uuid, timestamptz, timestamptz, int, int) to authenticated;

-- ============================================================
-- RLS EXTEND: admin/manager bisa read semua closed sessions di bar mereka
-- (untuk detail invoice page yang fetch langsung dari table)
-- ============================================================
create or replace function is_admin_or_manager_in_bar(p_profile_id uuid, p_bar_id uuid)
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
      and role in ('admin', 'manager')
      and is_active = true
  );
$$;

grant execute on function is_admin_or_manager_in_bar(uuid, uuid) to authenticated;
