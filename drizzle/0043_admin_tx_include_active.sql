-- 0043: admin_transactions juga tampilkan sesi BERJALAN (open/locked), bukan
-- hanya closed/overdue. Tambah kolom `status` supaya UI bisa tandai.

DROP FUNCTION IF EXISTS admin_transactions(uuid, timestamptz, timestamptz, integer, integer);

CREATE OR REPLACE FUNCTION public.admin_transactions(
  p_bar_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  session_id uuid,
  status text,
  closed_at timestamptz,
  started_at timestamptz,
  duration_minutes integer,
  table_label text,
  area_name text,
  host_name text,
  member_count integer,
  item_count integer,
  subtotal bigint,
  paid_total bigint,
  session_title text
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  select
    ts.id as session_id,
    ts.status::text as status,
    ts.closed_at,
    ts.started_at,
    -- belum closed → durasi sampai now()
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
    -- sesi berjalan (open/locked) + selesai (closed/overdue). reserved (booking
    -- belum mulai) tetap TIDAK termasuk — belum ada transaksi.
    and ts.status in ('open', 'locked', 'closed', 'overdue')
    and coalesce(ts.closed_at, ts.started_at) >= p_from
    and coalesce(ts.closed_at, ts.started_at) < p_to
  order by coalesce(ts.closed_at, ts.started_at) desc
  limit p_limit offset p_offset;
$function$;

-- admin_payment_status juga include sesi berjalan (open/locked) supaya stat
-- cards (lunas/belum lunas) konsisten dgn list transaksi.
CREATE OR REPLACE FUNCTION public.admin_payment_status(
  p_bar_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE(
  paid_count integer,
  paid_revenue bigint,
  unpaid_count integer,
  unpaid_billed bigint,
  unpaid_outstanding bigint
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  with sess as (
    select
      ts.id,
      (select coalesce(sum(oi.quantity * oi.unit_price), 0)
         from order_items oi
         join orders o on o.id = oi.order_id
        where o.session_id = ts.id and oi.status <> 'void')::bigint as subtotal,
      (select coalesce(sum(pay.amount), 0)
         from payments pay
         join orders o on o.id = pay.order_id
        where o.session_id = ts.id and pay.status = 'paid')::bigint as paid_total
    from table_sessions ts
    join tables t on t.id = ts.table_id
    join floor_areas fa on fa.id = t.area_id
    where fa.bar_id = p_bar_id
      and ts.status in ('open', 'locked', 'closed', 'overdue')
      and coalesce(ts.closed_at, ts.started_at) >= p_from
      and coalesce(ts.closed_at, ts.started_at) <  p_to
  )
  select
    count(*) filter (where paid_total >= subtotal)::int                       as paid_count,
    coalesce(sum(subtotal) filter (where paid_total >= subtotal), 0)::bigint   as paid_revenue,
    count(*) filter (where paid_total <  subtotal)::int                       as unpaid_count,
    coalesce(sum(subtotal) filter (where paid_total < subtotal), 0)::bigint    as unpaid_billed,
    coalesce(sum(subtotal - paid_total) filter (where paid_total < subtotal), 0)::bigint as unpaid_outstanding
  from sess;
$function$;
