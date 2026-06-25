-- 0032: dashboard & daftar transaksi admin ikut hitung sesi 'overdue' (nunggak),
-- bukan cuma 'closed'. Supaya jumlah transaksi konsisten di seluruh dashboard
-- (Transaksi, Net Sales, lunas/belum-lunas, chart, daftar transaksi).
--
-- Pola perubahan di semua fungsi:
--   status = 'closed'                  →  status IN ('closed','overdue')
--   filter & grouping pakai closed_at  →  COALESCE(closed_at, started_at)
--   (overdue belum punya closed_at, pakai started_at sbg waktu transaksi)

CREATE OR REPLACE FUNCTION public.admin_sales_summary(p_bar_id uuid, p_from timestamptz, p_to timestamptz)
 RETURNS TABLE(total_revenue bigint, transaction_count integer, unique_visitors integer, avg_bill bigint, total_items integer, avg_items_per_transaction numeric)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  with sessions_in_range as (
    select ts.id, ts.host_id
    from table_sessions ts
    join tables t on t.id = ts.table_id
    join floor_areas fa on fa.id = t.area_id
    where fa.bar_id = p_bar_id
      and ts.status in ('closed', 'overdue')
      and coalesce(ts.closed_at, ts.started_at) >= p_from
      and coalesce(ts.closed_at, ts.started_at) < p_to
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
    case when count(b.session_id) > 0 then (sum(b.bill_total) / count(b.session_id))::bigint else 0 end as avg_bill,
    coalesce(sum(b.item_count), 0)::int as total_items,
    case when count(b.session_id) > 0 then round(sum(b.item_count)::numeric / count(b.session_id), 1) else 0 end as avg_items_per_transaction
  from bills b;
$function$;

CREATE OR REPLACE FUNCTION public.admin_sales_by_day(p_bar_id uuid, p_from timestamptz, p_to timestamptz)
 RETURNS TABLE(sale_date date, total_revenue bigint, transaction_count integer)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  with daily as (
    select
      (coalesce(ts.closed_at, ts.started_at) at time zone 'Asia/Jakarta')::date as d,
      ts.id as session_id,
      coalesce(sum(oi.quantity * oi.unit_price), 0)::bigint as bill_total
    from table_sessions ts
    join tables t on t.id = ts.table_id
    join floor_areas fa on fa.id = t.area_id
    left join orders o on o.session_id = ts.id
    left join order_items oi on oi.order_id = o.id and oi.status <> 'void'
    where fa.bar_id = p_bar_id
      and ts.status in ('closed', 'overdue')
      and coalesce(ts.closed_at, ts.started_at) >= p_from
      and coalesce(ts.closed_at, ts.started_at) < p_to
    group by ts.id, d
  )
  select d as sale_date, sum(bill_total)::bigint as total_revenue, count(session_id)::int as transaction_count
  from daily group by d order by d;
$function$;

CREATE OR REPLACE FUNCTION public.admin_sales_by_hour(p_bar_id uuid, p_from timestamptz, p_to timestamptz)
 RETURNS TABLE(hour_of_day integer, total_revenue bigint, transaction_count integer)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  with hourly as (
    select
      extract(hour from (coalesce(ts.closed_at, ts.started_at) at time zone 'Asia/Jakarta'))::int as h,
      ts.id as session_id,
      coalesce(sum(oi.quantity * oi.unit_price), 0)::bigint as bill_total
    from table_sessions ts
    join tables t on t.id = ts.table_id
    join floor_areas fa on fa.id = t.area_id
    left join orders o on o.session_id = ts.id
    left join order_items oi on oi.order_id = o.id and oi.status <> 'void'
    where fa.bar_id = p_bar_id
      and ts.status in ('closed', 'overdue')
      and coalesce(ts.closed_at, ts.started_at) >= p_from
      and coalesce(ts.closed_at, ts.started_at) < p_to
    group by ts.id, h
  )
  select h as hour_of_day, sum(bill_total)::bigint as total_revenue, count(session_id)::int as transaction_count
  from hourly group by h order by h;
$function$;

CREATE OR REPLACE FUNCTION public.admin_top_items(p_bar_id uuid, p_from timestamptz, p_to timestamptz, p_limit integer DEFAULT 20)
 RETURNS TABLE(menu_item_id uuid, name text, category_name text, total_qty integer, total_revenue bigint, transaction_count integer)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  select
    mi.id as menu_item_id, mi.name, mc.name as category_name,
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
    and ts.status in ('closed', 'overdue')
    and coalesce(ts.closed_at, ts.started_at) >= p_from
    and coalesce(ts.closed_at, ts.started_at) < p_to
    and oi.status <> 'void'
  group by mi.id, mi.name, mc.name
  order by total_revenue desc
  limit p_limit;
$function$;

CREATE OR REPLACE FUNCTION public.admin_payment_methods(p_bar_id uuid, p_from timestamptz, p_to timestamptz)
 RETURNS TABLE(method text, total_amount bigint, payment_count integer, pct_share numeric)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  with paid as (
    select p.method, p.amount
    from payments p
    join orders o on o.id = p.order_id
    join table_sessions ts on ts.id = o.session_id
    join tables t on t.id = ts.table_id
    join floor_areas fa on fa.id = t.area_id
    where fa.bar_id = p_bar_id
      and ts.status in ('closed', 'overdue')
      and coalesce(ts.closed_at, ts.started_at) >= p_from
      and coalesce(ts.closed_at, ts.started_at) < p_to
      and p.status = 'paid'
  ),
  totals as (select coalesce(sum(amount), 0)::bigint as grand_total from paid)
  select
    method::text,
    sum(amount)::bigint as total_amount,
    count(*)::int as payment_count,
    case when (select grand_total from totals) > 0
      then round((sum(amount)::numeric / (select grand_total from totals)) * 100, 1) else 0 end as pct_share
  from paid group by method order by total_amount desc;
$function$;

CREATE OR REPLACE FUNCTION public.admin_transactions(p_bar_id uuid, p_from timestamptz, p_to timestamptz, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS TABLE(session_id uuid, closed_at timestamptz, started_at timestamptz, duration_minutes integer, table_label text, area_name text, host_name text, member_count integer, item_count integer, subtotal bigint, paid_total bigint, session_title text)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  select
    ts.id as session_id,
    ts.closed_at,
    ts.started_at,
    -- overdue: closed_at null → durasi sampai now()
    (extract(epoch from (coalesce(ts.closed_at, now()) - ts.started_at))::int / 60) as duration_minutes,
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
    and ts.status in ('closed', 'overdue')
    and coalesce(ts.closed_at, ts.started_at) >= p_from
    and coalesce(ts.closed_at, ts.started_at) < p_to
  order by coalesce(ts.closed_at, ts.started_at) desc
  limit p_limit offset p_offset;
$function$;
