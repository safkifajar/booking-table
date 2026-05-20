-- ============================================================
-- QUEUE NUMBER untuk order_items
--
-- Tambah kolom queue_number yang auto-increment per bar per hari.
-- Format display: #001, #002, ... reset tiap subuh (00:00).
--
-- Trigger BEFORE INSERT mengambil MAX(queue_number)+1 untuk item di
-- bar yang sama dan tanggal yang sama (timezone Asia/Jakarta).
-- ============================================================

alter table order_items
  add column if not exists queue_number int;

create index if not exists idx_order_items_queue_number
  on order_items (queue_number, created_at)
  where queue_number is not null;

-- Helper: ambil bar_id dari order_item (via order → session → table → area)
create or replace function get_bar_id_for_order_item(p_order_id uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select fa.bar_id
  from orders o
  join table_sessions ts on ts.id = o.session_id
  join tables t on t.id = ts.table_id
  join floor_areas fa on fa.id = t.area_id
  where o.id = p_order_id
  limit 1;
$$;

-- Trigger function
create or replace function assign_queue_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bar_id uuid;
  v_today date;
  v_next_num int;
begin
  -- Skip kalau queue_number sudah di-set manual (misalnya untuk seed)
  if new.queue_number is not null then
    return new;
  end if;

  v_bar_id := get_bar_id_for_order_item(new.order_id);
  if v_bar_id is null then
    return new;
  end if;

  -- Tanggal "operasional" = tanggal lokal Asia/Jakarta dari now()
  v_today := (now() at time zone 'Asia/Jakarta')::date;

  -- Ambil max queue_number untuk bar yang sama, di tanggal yang sama
  select coalesce(max(oi.queue_number), 0) + 1
  into v_next_num
  from order_items oi
  join orders o on o.id = oi.order_id
  join table_sessions ts on ts.id = o.session_id
  join tables t on t.id = ts.table_id
  join floor_areas fa on fa.id = t.area_id
  where fa.bar_id = v_bar_id
    and (oi.created_at at time zone 'Asia/Jakarta')::date = v_today;

  new.queue_number := v_next_num;
  return new;
end;
$$;

drop trigger if exists order_items_assign_queue_number on order_items;
create trigger order_items_assign_queue_number
  before insert on order_items
  for each row execute function assign_queue_number();

-- ============================================================
-- BACKFILL untuk data existing (sekali jalan)
-- ============================================================
do $$
declare
  r record;
  v_num int;
  v_current_bar uuid;
  v_current_date date;
begin
  -- Cek apakah ada yang belum di-fill
  if not exists (select 1 from order_items where queue_number is null) then
    raise notice 'No items need backfilling';
    return;
  end if;

  v_current_bar := null;
  v_current_date := null;
  v_num := 0;

  for r in
    select
      oi.id,
      fa.bar_id,
      (oi.created_at at time zone 'Asia/Jakarta')::date as item_date
    from order_items oi
    join orders o on o.id = oi.order_id
    join table_sessions ts on ts.id = o.session_id
    join tables t on t.id = ts.table_id
    join floor_areas fa on fa.id = t.area_id
    where oi.queue_number is null
    order by fa.bar_id, (oi.created_at at time zone 'Asia/Jakarta')::date, oi.created_at
  loop
    -- Reset counter saat bar atau tanggal ganti
    if r.bar_id <> v_current_bar or r.item_date <> v_current_date or v_current_bar is null then
      v_current_bar := r.bar_id;
      v_current_date := r.item_date;
      -- Ambil counter terakhir untuk bar + date itu (mungkin sudah ada via insert sebelumnya)
      select coalesce(max(oi2.queue_number), 0)
      into v_num
      from order_items oi2
      join orders o2 on o2.id = oi2.order_id
      join table_sessions ts2 on ts2.id = o2.session_id
      join tables t2 on t2.id = ts2.table_id
      join floor_areas fa2 on fa2.id = t2.area_id
      where fa2.bar_id = v_current_bar
        and (oi2.created_at at time zone 'Asia/Jakarta')::date = v_current_date;
    end if;

    v_num := v_num + 1;
    update order_items set queue_number = v_num where id = r.id;
  end loop;

  raise notice 'Backfill complete';
end;
$$;
