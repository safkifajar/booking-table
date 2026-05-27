-- ============================================================
-- DEMO SEED: closed sessions historis untuk laporan admin
--
-- Bikin ~25 closed sessions tersebar selama 30 hari terakhir
-- dengan order + payment lengkap, supaya admin dashboard punya
-- data realistik (chart, top sellers, payment breakdown).
--
-- IDEMPOTENT: skip kalau sudah ada > 5 closed sessions.
-- ============================================================

do $$
declare
  v_bar_id uuid;
  v_user_ids uuid[];
  v_table_ids uuid[];
  v_menu_signature uuid[];
  v_menu_classic uuid[];
  v_menu_bites uuid[];
  v_menu_mains uuid[];
  v_menu_wine uuid[];
  v_menu_beer uuid[];
  v_menu_mocktail uuid[];

  v_session_id uuid;
  v_order_id uuid;
  v_host_id uuid;
  v_table_id uuid;
  v_member_ids uuid[];
  v_member_record_ids uuid[];
  v_picked_member uuid;
  v_picked_member_id uuid;
  v_picked_menu uuid;
  v_picked_price int;
  v_qty int;

  i int;
  j int;
  member_count int;
  item_count int;
  v_started_at timestamptz;
  v_duration_min int;
  v_closed_at timestamptz;
  v_subtotal bigint;
begin
  -- Skip kalau sudah cukup data closed
  select count(*) into i from table_sessions where status = 'closed';
  if i > 5 then
    raise notice 'Sudah ada % closed sessions, skip seed', i;
    return;
  end if;

  select id into v_bar_id from bars where slug = 'soho-purwokerto' limit 1;
  if v_bar_id is null then
    raise notice 'Bar soho-purwokerto tidak ditemukan, abort';
    return;
  end if;

  -- Ambil semua demo user (8 user dari seed sebelumnya)
  select array_agg(id) into v_user_ids
  from auth.users
  where email like '%.demo@soho.id';

  if v_user_ids is null or array_length(v_user_ids, 1) < 3 then
    raise notice 'Demo users tidak cukup, jalankan 0008_demo_seed_sessions.sql dulu';
    return;
  end if;

  -- Ambil semua table id di bar ini
  select array_agg(t.id) into v_table_ids
  from tables t
  join floor_areas fa on fa.id = t.area_id
  where fa.bar_id = v_bar_id and t.is_active = true;

  -- Menu items grouped per kategori (untuk distribusi realistik)
  select array_agg(mi.id) into v_menu_signature
  from menu_items mi
  join menu_categories mc on mc.id = mi.category_id
  where mc.bar_id = v_bar_id and mc.slug = 'signature';

  select array_agg(mi.id) into v_menu_classic
  from menu_items mi
  join menu_categories mc on mc.id = mi.category_id
  where mc.bar_id = v_bar_id and mc.slug = 'classic';

  select array_agg(mi.id) into v_menu_bites
  from menu_items mi
  join menu_categories mc on mc.id = mi.category_id
  where mc.bar_id = v_bar_id and mc.slug = 'bites';

  select array_agg(mi.id) into v_menu_mains
  from menu_items mi
  join menu_categories mc on mc.id = mi.category_id
  where mc.bar_id = v_bar_id and mc.slug = 'mains';

  select array_agg(mi.id) into v_menu_wine
  from menu_items mi
  join menu_categories mc on mc.id = mi.category_id
  where mc.bar_id = v_bar_id and mc.slug = 'wine';

  select array_agg(mi.id) into v_menu_beer
  from menu_items mi
  join menu_categories mc on mc.id = mi.category_id
  where mc.bar_id = v_bar_id and mc.slug = 'beer';

  select array_agg(mi.id) into v_menu_mocktail
  from menu_items mi
  join menu_categories mc on mc.id = mi.category_id
  where mc.bar_id = v_bar_id and mc.slug = 'mocktails';

  -- Loop bikin 25 session, tersebar di 30 hari terakhir
  for i in 1..25 loop
    -- Random host
    v_host_id := v_user_ids[1 + floor(random() * array_length(v_user_ids, 1))::int];

    -- Random table — yang tidak ada session aktif
    select array_agg(t.id) into v_table_ids
    from tables t
    join floor_areas fa on fa.id = t.area_id
    where fa.bar_id = v_bar_id
      and t.is_active = true
      and not exists (
        select 1 from table_sessions ts
        where ts.table_id = t.id and ts.status in ('open', 'locked')
      );

    if v_table_ids is null or array_length(v_table_ids, 1) = 0 then
      raise notice 'No available tables, skip';
      continue;
    end if;

    v_table_id := v_table_ids[1 + floor(random() * array_length(v_table_ids, 1))::int];

    -- Started time: random selama 30 hari ke belakang, jam 17-23 (operating hours)
    v_started_at := (now() - (random() * 30 * interval '1 day'))::date
      + (17 + floor(random() * 6)) * interval '1 hour'
      + floor(random() * 60) * interval '1 minute';

    -- Duration: 45 menit sampai 4 jam
    v_duration_min := 45 + floor(random() * 195)::int;
    v_closed_at := v_started_at + (v_duration_min * interval '1 minute');

    -- Skip kalau closed_at > sekarang
    if v_closed_at > now() then
      v_closed_at := now() - interval '5 minutes';
    end if;

    -- Insert session
    insert into table_sessions (
      table_id, host_id, status, visibility, title, vibe_tags,
      started_at, closed_at
    ) values (
      v_table_id, v_host_id, 'closed', 'public',
      (array['Friday night', 'Hangout', 'Anniversary', 'After work', 'Catch up',
             'Birthday', 'Date night', 'Reunion', 'Cocktail night'])[1 + floor(random() * 9)::int],
      (array[array['chill', 'fun'], array['celebrate'], array['networking', 'chill'],
             array['date'], array['loud', 'fun']])[1 + floor(random() * 5)::int],
      v_started_at, v_closed_at
    ) returning id into v_session_id;

    -- Members: host + 1-5 random tambahan (yang bukan host)
    member_count := 1 + floor(random() * 5)::int;
    v_member_ids := array[v_host_id];
    for j in 1..member_count loop
      v_picked_member := v_user_ids[1 + floor(random() * array_length(v_user_ids, 1))::int];
      if not (v_picked_member = any(v_member_ids)) then
        v_member_ids := v_member_ids || v_picked_member;
      end if;
    end loop;

    -- Insert members (host first, sisanya member)
    v_member_record_ids := array[]::uuid[];
    for j in 1..array_length(v_member_ids, 1) loop
      insert into session_members (session_id, profile_id, role, status, joined_at)
      values (
        v_session_id, v_member_ids[j],
        case when j = 1 then 'host'::member_role else 'member'::member_role end,
        'left',
        v_started_at + (j * interval '3 minutes')
      ) on conflict (session_id, profile_id) do nothing
      returning id into v_picked_member_id;
      if v_picked_member_id is not null then
        v_member_record_ids := v_member_record_ids || v_picked_member_id;
      end if;
    end loop;

    -- Insert order
    insert into orders (session_id, status, created_at, closed_at)
    values (v_session_id, 'closed', v_started_at + interval '5 minutes', v_closed_at)
    returning id into v_order_id;

    -- Items: 3-12 random items mixed categories
    item_count := 3 + floor(random() * 10)::int;
    v_subtotal := 0;
    for j in 1..item_count loop
      -- Distribusi kategori (cocktails paling sering)
      v_picked_menu := case floor(random() * 10)::int
        when 0,1,2 then v_menu_signature[1 + floor(random() * array_length(v_menu_signature, 1))::int]
        when 3,4 then v_menu_classic[1 + floor(random() * array_length(v_menu_classic, 1))::int]
        when 5 then v_menu_beer[1 + floor(random() * array_length(v_menu_beer, 1))::int]
        when 6 then v_menu_wine[1 + floor(random() * array_length(v_menu_wine, 1))::int]
        when 7 then v_menu_mocktail[1 + floor(random() * array_length(v_menu_mocktail, 1))::int]
        when 8 then v_menu_bites[1 + floor(random() * array_length(v_menu_bites, 1))::int]
        else v_menu_mains[1 + floor(random() * array_length(v_menu_mains, 1))::int]
      end;

      v_qty := 1 + floor(random() * 3)::int;
      v_picked_member_id := v_member_record_ids[1 + floor(random() * array_length(v_member_record_ids, 1))::int];

      select price into v_picked_price from menu_items where id = v_picked_menu;

      insert into order_items (
        order_id, menu_item_id, added_by_member_id, quantity, unit_price, status,
        created_at, served_at
      ) values (
        v_order_id, v_picked_menu, v_picked_member_id, v_qty, v_picked_price, 'served',
        v_started_at + interval '10 minutes' + (j * interval '4 minutes'),
        v_started_at + interval '20 minutes' + (j * interval '4 minutes')
      );

      v_subtotal := v_subtotal + (v_qty * v_picked_price);
    end loop;

    -- Payments: variasi mode
    -- 70% lunas, 30% partial
    if random() < 0.7 then
      -- Lunas
      -- 50% equal split, 30% itemized (1 payment per member), 20% one person treats
      case floor(random() * 10)::int
        when 0,1,2,3,4 then
          -- Equal split: bagi rata, 1 payment per member
          for j in 1..array_length(v_member_record_ids, 1) loop
            insert into payments (
              order_id, paid_by_member_id, amount, method, status, split_mode, paid_at
            ) values (
              v_order_id, v_member_record_ids[j],
              (v_subtotal / array_length(v_member_record_ids, 1))::int,
              (array['qris','gopay','card','cash','qris'])[1 + floor(random() * 5)::int]::payment_method,
              'paid', 'equal', v_closed_at - interval '2 minutes'
            );
          end loop;
        when 5,6,7 then
          -- Itemized: simplified — satu payment besar dari split itemized
          insert into payments (
            order_id, paid_by_member_id, amount, method, status, split_mode, paid_at
          ) values (
            v_order_id, v_member_record_ids[1], v_subtotal,
            (array['qris','gopay','card'])[1 + floor(random() * 3)::int]::payment_method,
            'paid', 'itemized', v_closed_at - interval '2 minutes'
          );
        else
          -- Host treats
          insert into payments (
            order_id, paid_by_member_id, amount, method, status, split_mode, paid_at
          ) values (
            v_order_id, v_member_record_ids[1], v_subtotal,
            (array['card','qris'])[1 + floor(random() * 2)::int]::payment_method,
            'paid', 'custom', v_closed_at - interval '2 minutes'
          );
      end case;
    else
      -- Partial: bayar 60-90% saja
      insert into payments (
        order_id, paid_by_member_id, amount, method, status, split_mode, paid_at
      ) values (
        v_order_id, v_member_record_ids[1],
        (v_subtotal * (0.6 + random() * 0.3))::int,
        'cash'::payment_method,
        'paid', 'equal', v_closed_at - interval '2 minutes'
      );
    end if;
  end loop;

  raise notice 'Seeded 25 closed sessions';
end;
$$;
