-- 0053: laporan admin — total_revenue = pembayaran AKTUAL (sudah termasuk
-- tax + service charge, karena customer bayar total). Sebelumnya revenue =
-- SUM(qty*price) alias subtotal saja. Kini revenue mencerminkan uang masuk.
--
-- Yang diubah: admin_sales_summary, admin_sales_by_day, admin_sales_by_hour →
-- pakai payments (status='paid') sebagai basis revenue.
-- admin_payment_methods sudah pakai payments (tak diubah).
-- admin_top_items TETAP subtotal item (tax/service tak diatribusikan ke item).

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
      -- Revenue = pembayaran lunas (termasuk tax+service). Kalau belum ada
      -- pembayaran, 0.
      coalesce((
        select sum(p.amount) from payments p
        join orders o2 on o2.id = p.order_id
        where o2.session_id = sr.id and p.status = 'paid'
      ), 0)::bigint as paid_total,
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
    coalesce(sum(b.paid_total), 0)::bigint as total_revenue,
    count(b.session_id)::int as transaction_count,
    (select cnt from visitors) as unique_visitors,
    case when count(b.session_id) > 0 then (sum(b.paid_total) / count(b.session_id))::bigint else 0 end as avg_bill,
    coalesce(sum(b.item_count), 0)::int as total_items,
    case when count(b.session_id) > 0 then round(sum(b.item_count)::numeric / count(b.session_id), 1) else 0 end as avg_items_per_transaction
  from bills b;
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
      coalesce((
        select sum(p.amount) from payments p
        join orders o2 on o2.id = p.order_id
        where o2.session_id = ts.id and p.status = 'paid'
      ), 0)::bigint as paid_total
    from table_sessions ts
    join tables t on t.id = ts.table_id
    join floor_areas fa on fa.id = t.area_id
    where fa.bar_id = p_bar_id
      and ts.status in ('open', 'locked', 'closed', 'overdue')
      and coalesce(ts.closed_at, ts.started_at) >= p_from
      and coalesce(ts.closed_at, ts.started_at) < p_to
  )
  select d as sale_date, sum(paid_total)::bigint as total_revenue, count(session_id)::int as transaction_count
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
      coalesce((
        select sum(p.amount) from payments p
        join orders o2 on o2.id = p.order_id
        where o2.session_id = ts.id and p.status = 'paid'
      ), 0)::bigint as paid_total
    from table_sessions ts
    join tables t on t.id = ts.table_id
    join floor_areas fa on fa.id = t.area_id
    where fa.bar_id = p_bar_id
      and ts.status in ('open', 'locked', 'closed', 'overdue')
      and coalesce(ts.closed_at, ts.started_at) >= p_from
      and coalesce(ts.closed_at, ts.started_at) < p_to
  )
  select h as hour_of_day, sum(paid_total)::bigint as total_revenue, count(session_id)::int as transaction_count
  from hourly group by h order by h;
$function$;
