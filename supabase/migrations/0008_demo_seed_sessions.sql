-- ============================================================
-- DEMO SEED: 4 "live" sessions untuk landing page yang ramai
--
-- Bikin auth users + profiles + 4 active sessions di area Indoor & Rooftop
-- dengan members, order items, dan payments parsial.
--
-- IDEMPOTENT: bisa dijalankan ulang, akan skip kalau data sudah ada.
-- ============================================================

-- Helper: insert auth user dengan email confirmed + nama
create or replace function _demo_create_user(p_email text, p_name text)
returns uuid
language plpgsql
security definer
as $$
declare
  v_id uuid;
begin
  -- Cek apakah email sudah ada
  select id into v_id from auth.users where email = p_email;
  if v_id is not null then
    return v_id;
  end if;

  -- Buat auth user baru
  v_id := gen_random_uuid();
  insert into auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    aud, role, created_at, updated_at, is_anonymous
  ) values (
    v_id,
    '00000000-0000-0000-0000-000000000000',
    p_email,
    crypt('demo123', gen_salt('bf')),
    now(),
    jsonb_build_object('provider', 'email', 'providers', array['email']),
    jsonb_build_object('display_name', p_name),
    'authenticated',
    'authenticated',
    now() - interval '7 days',
    now(),
    false
  );

  -- Trigger handle_new_user akan otomatis bikin profile, tapi pastikan nama-nya benar
  update profiles set display_name = p_name where id = v_id;

  return v_id;
end;
$$;

-- ============================================================
-- BUAT 8 DEMO USERS (host + member untuk 4 meja)
-- Password semua: demo123 (cuma untuk demo, jangan dipakai produksi)
-- ============================================================

do $$
declare
  -- Hosts
  v_dimas uuid := _demo_create_user('dimas.demo@soho.id', 'Dimas');
  v_sarah uuid := _demo_create_user('sarah.demo@soho.id', 'Sarah');
  v_rafi uuid := _demo_create_user('rafi.demo@soho.id', 'Rafi');
  v_kirana uuid := _demo_create_user('kirana.demo@soho.id', 'Kirana');
  -- Members
  v_alif uuid := _demo_create_user('alif.demo@soho.id', 'Alif');
  v_nadia uuid := _demo_create_user('nadia.demo@soho.id', 'Nadia');
  v_bima uuid := _demo_create_user('bima.demo@soho.id', 'Bima');
  v_putri uuid := _demo_create_user('putri.demo@soho.id', 'Putri');

  -- Table IDs (resolve by label)
  v_table_b1 uuid;
  v_table_t2 uuid;
  v_table_rl1 uuid;
  v_table_vip uuid;

  -- Session IDs
  v_session_b1 uuid;
  v_session_t2 uuid;
  v_session_rl1 uuid;
  v_session_vip uuid;

  -- Order IDs
  v_order_b1 uuid;
  v_order_t2 uuid;
  v_order_rl1 uuid;
  v_order_vip uuid;

  -- Menu item IDs
  v_signature uuid;
  v_classic uuid;
  v_mocktail uuid;
  v_beer uuid;
  v_bites uuid;
  v_main uuid;
  v_wine uuid;
begin
  -- Skip kalau sudah ada demo session aktif
  if exists (
    select 1 from table_sessions ts
    join profiles p on p.id = ts.host_id
    where p.display_name in ('Dimas', 'Sarah', 'Rafi', 'Kirana')
      and ts.status = 'open'
  ) then
    raise notice 'Demo sessions already exist, skipping seed';
    return;
  end if;

  -- Resolve tables
  select t.id into v_table_b1 from tables t
    join floor_areas fa on fa.id = t.area_id
    where t.label = 'B1' and fa.slug = 'indoor' limit 1;
  select t.id into v_table_t2 from tables t
    join floor_areas fa on fa.id = t.area_id
    where t.label = 'T2' and fa.slug = 'indoor' limit 1;
  select t.id into v_table_rl1 from tables t
    join floor_areas fa on fa.id = t.area_id
    where t.label = 'R-L1' and fa.slug = 'rooftop' limit 1;
  select t.id into v_table_vip from tables t
    join floor_areas fa on fa.id = t.area_id
    where t.label = 'VIP' and fa.slug = 'rooftop' limit 1;

  -- ============================================================
  -- SESSION 1: B1 Indoor Booth, host Dimas, "After-work hangout"
  -- 4/6 members, ordering signature cocktails + bites
  -- ============================================================
  insert into table_sessions (
    table_id, host_id, status, visibility, title, vibe_tags, started_at
  ) values (
    v_table_b1, v_dimas, 'open', 'public', 'After-work hangout',
    array['networking', 'chill'], now() - interval '45 minutes'
  ) returning id into v_session_b1;

  insert into session_members (session_id, profile_id, role, status, joined_at) values
    (v_session_b1, v_dimas, 'host', 'joined', now() - interval '45 minutes'),
    (v_session_b1, v_alif, 'member', 'joined', now() - interval '40 minutes'),
    (v_session_b1, v_nadia, 'member', 'joined', now() - interval '35 minutes'),
    (v_session_b1, v_bima, 'member', 'joined', now() - interval '20 minutes');

  insert into session_invites (session_id, code, created_by) values
    (v_session_b1, 'DM' || upper(substr(md5(random()::text), 1, 4)), v_dimas);

  insert into orders (session_id, status, created_at)
  values (v_session_b1, 'open', now() - interval '40 minutes')
  returning id into v_order_b1;

  -- Order items untuk B1
  select id into v_signature from menu_items where name = 'SOHO Sunset' limit 1;
  insert into order_items (order_id, menu_item_id, added_by_member_id, quantity, unit_price, status)
    select v_order_b1, v_signature,
      (select id from session_members where session_id = v_session_b1 and profile_id = v_dimas),
      2, price, 'served' from menu_items where name = 'SOHO Sunset';

  select id into v_classic from menu_items where name = 'Negroni' limit 1;
  insert into order_items (order_id, menu_item_id, added_by_member_id, quantity, unit_price, status)
    select v_order_b1, v_classic,
      (select id from session_members where session_id = v_session_b1 and profile_id = v_alif),
      1, price, 'served' from menu_items where name = 'Negroni';

  select id into v_bites from menu_items where name = 'Truffle Fries' limit 1;
  insert into order_items (order_id, menu_item_id, added_by_member_id, quantity, unit_price, notes, status)
    select v_order_b1, v_bites,
      (select id from session_members where session_id = v_session_b1 and profile_id = v_nadia),
      1, price, 'extra cheese', 'preparing' from menu_items where name = 'Truffle Fries';

  insert into order_items (order_id, menu_item_id, added_by_member_id, quantity, unit_price, status)
    select v_order_b1, id,
      (select id from session_members where session_id = v_session_b1 and profile_id = v_bima),
      1, price, 'served' from menu_items where name = 'Crispy Chicken Wings';

  -- ============================================================
  -- SESSION 2: T2 Indoor Round, host Sarah, "Sarah's birthday"
  -- 3/4 members, sudah pesan banyak, payment parsial
  -- ============================================================
  insert into table_sessions (
    table_id, host_id, status, visibility, title, vibe_tags, started_at
  ) values (
    v_table_t2, v_sarah, 'open', 'friends', 'Sarah''s birthday',
    array['celebrate', 'fun'], now() - interval '1 hour 20 minutes'
  ) returning id into v_session_t2;

  insert into session_members (session_id, profile_id, role, status, joined_at) values
    (v_session_t2, v_sarah, 'host', 'joined', now() - interval '1 hour 20 minutes'),
    (v_session_t2, v_putri, 'member', 'joined', now() - interval '1 hour 10 minutes'),
    (v_session_t2, v_kirana, 'member', 'joined', now() - interval '50 minutes');

  insert into session_invites (session_id, code, created_by) values
    (v_session_t2, 'SR' || upper(substr(md5(random()::text), 1, 4)), v_sarah);

  insert into orders (session_id, status, created_at)
  values (v_session_t2, 'open', now() - interval '1 hour 15 minutes')
  returning id into v_order_t2;

  -- Espresso Martini × 3 (untuk semua member)
  insert into order_items (order_id, menu_item_id, added_by_member_id, quantity, unit_price, status)
    select v_order_t2, id,
      (select id from session_members where session_id = v_session_t2 and profile_id = v_sarah),
      3, price, 'served' from menu_items where name = 'Espresso Martini';

  -- Cheese platter sharing
  insert into order_items (order_id, menu_item_id, added_by_member_id, quantity, unit_price, status)
    select v_order_t2, id,
      (select id from session_members where session_id = v_session_t2 and profile_id = v_putri),
      1, price, 'served' from menu_items where name = 'Cheese & Charcuterie';

  -- Prosecco bottle untuk birthday
  insert into order_items (order_id, menu_item_id, added_by_member_id, quantity, unit_price, status)
    select v_order_t2, id,
      (select id from session_members where session_id = v_session_t2 and profile_id = v_sarah),
      1, price, 'served' from menu_items where name = 'Prosecco (bottle)';

  -- Sliders
  insert into order_items (order_id, menu_item_id, added_by_member_id, quantity, unit_price, status)
    select v_order_t2, id,
      (select id from session_members where session_id = v_session_t2 and profile_id = v_kirana),
      1, price, 'preparing' from menu_items where name = 'Beef Sliders (3pc)';

  -- Sarah sudah bayar 50% (equal split nya)
  insert into payments (
    order_id, paid_by_member_id, amount, method, status, split_mode, paid_at
  )
  select
    v_order_t2,
    (select id from session_members where session_id = v_session_t2 and profile_id = v_sarah),
    ceil(sum(quantity * unit_price) / 3.0),
    'qris', 'paid', 'equal', now() - interval '15 minutes'
  from order_items where order_id = v_order_t2 and status <> 'void';

  -- ============================================================
  -- SESSION 3: R-L1 Rooftop Lounge, host Rafi, "Rooftop chill"
  -- 5/8 members, banyak orang, vibe casual
  -- ============================================================
  insert into table_sessions (
    table_id, host_id, status, visibility, title, vibe_tags, started_at
  ) values (
    v_table_rl1, v_rafi, 'open', 'public', 'Rooftop chill',
    array['chill', 'good-vibes'], now() - interval '30 minutes'
  ) returning id into v_session_rl1;

  insert into session_members (session_id, profile_id, role, status, joined_at) values
    (v_session_rl1, v_rafi, 'host', 'joined', now() - interval '30 minutes'),
    (v_session_rl1, v_bima, 'member', 'joined', now() - interval '25 minutes'),
    (v_session_rl1, v_alif, 'member', 'joined', now() - interval '20 minutes'),
    (v_session_rl1, v_nadia, 'member', 'joined', now() - interval '15 minutes'),
    (v_session_rl1, v_dimas, 'member', 'joined', now() - interval '10 minutes');

  insert into session_invites (session_id, code, created_by) values
    (v_session_rl1, 'RF' || upper(substr(md5(random()::text), 1, 4)), v_rafi);

  insert into orders (session_id, status, created_at)
  values (v_session_rl1, 'open', now() - interval '25 minutes')
  returning id into v_order_rl1;

  -- Beer × 5
  insert into order_items (order_id, menu_item_id, added_by_member_id, quantity, unit_price, status)
    select v_order_rl1, id,
      (select id from session_members where session_id = v_session_rl1 and profile_id = v_rafi),
      5, price, 'served' from menu_items where name = 'Heineken';

  -- Edamame
  insert into order_items (order_id, menu_item_id, added_by_member_id, quantity, unit_price, notes, status)
    select v_order_rl1, id,
      (select id from session_members where session_id = v_session_rl1 and profile_id = v_alif),
      2, price, 'spicy', 'served' from menu_items where name = 'Edamame';

  -- Mojito non-alcoholic (mocktail untuk Nadia)
  insert into order_items (order_id, menu_item_id, added_by_member_id, quantity, unit_price, status)
    select v_order_rl1, id,
      (select id from session_members where session_id = v_session_rl1 and profile_id = v_nadia),
      1, price, 'served' from menu_items where name = 'Virgin Mojito';

  -- ============================================================
  -- SESSION 4: VIP Rooftop, host Kirana, "Anniversary night"
  -- 6/10 members, big spender (wine bottle, wagyu)
  -- ============================================================
  insert into table_sessions (
    table_id, host_id, status, visibility, title, vibe_tags, started_at
  ) values (
    v_table_vip, v_kirana, 'open', 'invite_only', 'Anniversary night',
    array['celebrate', 'premium'], now() - interval '2 hours'
  ) returning id into v_session_vip;

  insert into session_members (session_id, profile_id, role, status, joined_at) values
    (v_session_vip, v_kirana, 'host', 'joined', now() - interval '2 hours'),
    (v_session_vip, v_putri, 'member', 'joined', now() - interval '1 hour 50 minutes'),
    (v_session_vip, v_sarah, 'member', 'joined', now() - interval '1 hour 45 minutes'),
    (v_session_vip, v_rafi, 'member', 'joined', now() - interval '1 hour 40 minutes'),
    (v_session_vip, v_dimas, 'member', 'joined', now() - interval '1 hour 30 minutes'),
    (v_session_vip, v_bima, 'member', 'joined', now() - interval '1 hour 20 minutes');

  insert into session_invites (session_id, code, created_by) values
    (v_session_vip, 'KR' || upper(substr(md5(random()::text), 1, 4)), v_kirana);

  insert into orders (session_id, status, created_at)
  values (v_session_vip, 'open', now() - interval '1 hour 50 minutes')
  returning id into v_order_vip;

  -- Wine bottle premium
  insert into order_items (order_id, menu_item_id, added_by_member_id, quantity, unit_price, status)
    select v_order_vip, id,
      (select id from session_members where session_id = v_session_vip and profile_id = v_kirana),
      2, price, 'served' from menu_items where name = 'House Red (bottle)';

  -- Wagyu steaks
  insert into order_items (order_id, menu_item_id, added_by_member_id, quantity, unit_price, status)
    select v_order_vip, id,
      (select id from session_members where session_id = v_session_vip and profile_id = v_kirana),
      3, price, 'served' from menu_items where name = 'Wagyu Steak (200g)';

  -- Salmon
  insert into order_items (order_id, menu_item_id, added_by_member_id, quantity, unit_price, status)
    select v_order_vip, id,
      (select id from session_members where session_id = v_session_vip and profile_id = v_putri),
      2, price, 'served' from menu_items where name = 'Grilled Salmon';

  -- Tuna tartare
  insert into order_items (order_id, menu_item_id, added_by_member_id, quantity, unit_price, status)
    select v_order_vip, id,
      (select id from session_members where session_id = v_session_vip and profile_id = v_sarah),
      2, price, 'served' from menu_items where name = 'Tuna Tartare';

  -- Signature cocktails for the table
  insert into order_items (order_id, menu_item_id, added_by_member_id, quantity, unit_price, status)
    select v_order_vip, id,
      (select id from session_members where session_id = v_session_vip and profile_id = v_rafi),
      6, price, 'served' from menu_items where name = 'Banyumas Old Fashioned';

  -- Kirana sudah bayar 100% bagiannya (host paying)
  insert into payments (
    order_id, paid_by_member_id, amount, method, status, split_mode, paid_at
  )
  select
    v_order_vip,
    (select id from session_members where session_id = v_session_vip and profile_id = v_kirana),
    ceil(sum(quantity * unit_price) / 6.0 * 2), -- bayar untuk dia + 1 partner
    'card', 'paid', 'custom', now() - interval '20 minutes'
  from order_items where order_id = v_order_vip and status <> 'void';

  raise notice 'Demo seed complete: 4 sessions, 8 users, ~16 order items, 2 payments';
end;
$$;

-- Verifikasi
select
  ts.title,
  t.label as meja,
  fa.name as area,
  ts.visibility,
  p.display_name as host,
  (select count(*) from session_members sm where sm.session_id = ts.id) as members,
  (select count(*) from order_items oi join orders o on o.id = oi.order_id where o.session_id = ts.id) as items
from table_sessions ts
join tables t on t.id = ts.table_id
join floor_areas fa on fa.id = t.area_id
join profiles p on p.id = ts.host_id
where ts.status = 'open'
order by ts.started_at;
