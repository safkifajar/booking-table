-- 0031: agregasi status pembayaran (lunas vs belum lunas) untuk dashboard admin.
-- Cakupan: sesi 'closed' + 'overdue' dalam periode.
--   - closed → pakai closed_at sbg waktu transaksi
--   - overdue → belum ditutup, pakai started_at sbg waktu (supaya tetap masuk periode)
-- Lunas        = paid_total >= subtotal (termasuk subtotal 0 = tak ada tagihan)
-- Belum lunas  = paid_total <  subtotal
-- paid_revenue = NILAI TAGIHAN transaksi lunas (subtotal). Basis konsisten:
--                paid_revenue + unpaid_billed = total tagihan semua transaksi.
-- unpaid_billed = NILAI TAGIHAN penuh transaksi belum lunas (subtotal).
-- unpaid_outstanding = sisa yg belum dibayar (subtotal - paid_total) — utk nagih.
-- DROP dulu: return columns berubah, CREATE OR REPLACE tak bisa ganti signature.
DROP FUNCTION IF EXISTS public.admin_payment_status(uuid, timestamptz, timestamptz);
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
      and ts.status in ('closed', 'overdue')
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
