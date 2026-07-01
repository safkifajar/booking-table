-- 0044: selaraskan RPC laporan admin dgn 0043 — include sesi berjalan (open/locked)
-- supaya Net Sales / chart metode / by-day/hour / top-items konsisten dgn Admin Transaksi.

CREATE OR REPLACE FUNCTION public.admin_sales_summary(p_bar_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(total_revenue bigint, transaction_count integer, unique_visitors integer, avg_bill bigint, total_items integer, avg_items_per_transaction numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with sessions_in_range as (
    select ts.id, ts.host_id
    from table_sessions ts
    join tables t on t.id = ts.table_id
    join floor_areas fa on fa.id = t.area_id
    where fa.bar_id = p_bar_id
      and ts.status in ('open', 'locked', 'closed', 'overdue')
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

CREATE OR REPLACE FUNCTION public.admin_payment_methods(p_bar_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(method text, total_amount bigint, payment_count integer, pct_share numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with paid as (
    select p.method, p.amount
    from payments p
    join orders o on o.id = p.order_id
    join table_sessions ts on ts.id = o.session_id
    join tables t on t.id = ts.table_id
    join floor_areas fa on fa.id = t.area_id
    where fa.bar_id = p_bar_id
      and ts.status in ('open', 'locked', 'closed', 'overdue')
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

CREATE OR REPLACE FUNCTION public.admin_sales_by_day(p_bar_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(sale_date date, total_revenue bigint, transaction_count integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
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
      and ts.status in ('open', 'locked', 'closed', 'overdue')
      and coalesce(ts.closed_at, ts.started_at) >= p_from
      and coalesce(ts.closed_at, ts.started_at) < p_to
    group by ts.id, d
  )
  select d as sale_date, sum(bill_total)::bigint as total_revenue, count(session_id)::int as transaction_count
  from daily group by d order by d;
$function$;

CREATE OR REPLACE FUNCTION public.admin_sales_by_hour(p_bar_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(hour_of_day integer, total_revenue bigint, transaction_count integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
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
      and ts.status in ('open', 'locked', 'closed', 'overdue')
      and coalesce(ts.closed_at, ts.started_at) >= p_from
      and coalesce(ts.closed_at, ts.started_at) < p_to
    group by ts.id, h
  )
  select h as hour_of_day, sum(bill_total)::bigint as total_revenue, count(session_id)::int as transaction_count
  from hourly group by h order by h;
$function$;

CREATE OR REPLACE FUNCTION public.admin_top_items(p_bar_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_limit integer DEFAULT 20)
 RETURNS TABLE(menu_item_id uuid, name text, category_name text, total_qty integer, total_revenue bigint, transaction_count integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
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
    and ts.status in ('open', 'locked', 'closed', 'overdue')
    and coalesce(ts.closed_at, ts.started_at) >= p_from
    and coalesce(ts.closed_at, ts.started_at) < p_to
    and oi.status <> 'void'
  group by mi.id, mi.name, mc.name
  order by total_revenue desc
  limit p_limit;
$function$;

