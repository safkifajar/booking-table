-- ============================================================
-- BOOKING TABLE — main schema
-- Postgres / Supabase
-- ============================================================

-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================
create type session_status as enum ('open', 'locked', 'closed', 'cancelled');
create type session_visibility as enum ('public', 'friends', 'invite_only');
create type member_role as enum ('host', 'member', 'guest');
create type member_status as enum ('pending', 'joined', 'left', 'kicked');
create type table_shape as enum ('round', 'square', 'rect', 'booth');
create type order_status as enum ('open', 'submitted', 'preparing', 'served', 'closed');
create type order_item_status as enum ('draft', 'sent', 'preparing', 'served', 'void');
create type payment_method as enum ('qris', 'cash', 'card', 'gopay', 'ovo', 'mock');
create type payment_status as enum ('pending', 'paid', 'failed', 'refunded');
create type split_mode as enum ('equal', 'itemized', 'custom');
create type staff_role as enum ('waiter', 'manager', 'admin');

-- ============================================================
-- PROFILES (extends auth.users)
-- ============================================================
create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null,
  avatar_url    text,
  phone         text,
  created_at    timestamptz not null default now()
);

-- Auto-create profile row when a new auth user is created
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1), 'Guest'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- BARS
-- ============================================================
create table bars (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  name            text not null,
  tagline         text,
  address         text,
  logo_url        text,
  cover_url       text,
  theme           jsonb default '{}'::jsonb,
  opening_hours   jsonb default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

-- ============================================================
-- FLOOR AREAS
-- ============================================================
create table floor_areas (
  id              uuid primary key default gen_random_uuid(),
  bar_id          uuid not null references bars(id) on delete cascade,
  name            text not null,
  slug            text not null,
  canvas_width    int not null default 800,
  canvas_height   int not null default 600,
  background_url  text,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  unique(bar_id, slug)
);

-- ============================================================
-- TABLES (meja fisik)
-- ============================================================
create table tables (
  id          uuid primary key default gen_random_uuid(),
  area_id     uuid not null references floor_areas(id) on delete cascade,
  label       text not null,
  shape       table_shape not null default 'round',
  capacity    int not null default 4,
  pos_x       int not null default 0,
  pos_y       int not null default 0,
  width       int not null default 80,
  height      int not null default 80,
  rotation    int not null default 0,
  is_active   boolean not null default true,
  min_spend   int default 0,
  created_at  timestamptz not null default now(),
  unique(area_id, label)
);

-- ============================================================
-- TABLE SESSIONS (open table)
-- ============================================================
create table table_sessions (
  id          uuid primary key default gen_random_uuid(),
  table_id    uuid not null references tables(id) on delete restrict,
  host_id     uuid not null references profiles(id) on delete restrict,
  status      session_status not null default 'open',
  visibility  session_visibility not null default 'public',
  title       text,
  vibe_tags   text[] default '{}',
  max_guests  int,
  started_at  timestamptz not null default now(),
  closed_at   timestamptz,
  notes       text,
  created_at  timestamptz not null default now()
);

-- Hanya boleh 1 session open/locked per table pada satu waktu
create unique index uniq_active_session_per_table
  on table_sessions (table_id)
  where status in ('open', 'locked');

create index idx_sessions_visibility on table_sessions (visibility, status);
create index idx_sessions_host on table_sessions (host_id);

-- ============================================================
-- SESSION MEMBERS
-- ============================================================
create table session_members (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references table_sessions(id) on delete cascade,
  profile_id  uuid not null references profiles(id) on delete cascade,
  role        member_role not null default 'member',
  status      member_status not null default 'joined',
  joined_at   timestamptz not null default now(),
  left_at     timestamptz,
  unique(session_id, profile_id)
);

create index idx_members_session on session_members (session_id);
create index idx_members_profile on session_members (profile_id);

-- ============================================================
-- SESSION INVITES (link/code)
-- ============================================================
create table session_invites (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references table_sessions(id) on delete cascade,
  code        text not null unique,
  created_by  uuid not null references profiles(id) on delete restrict,
  expires_at  timestamptz not null default (now() + interval '2 hours'),
  max_uses    int,
  use_count   int not null default 0,
  created_at  timestamptz not null default now()
);

create index idx_invites_session on session_invites (session_id);

-- ============================================================
-- MENU
-- ============================================================
create table menu_categories (
  id          uuid primary key default gen_random_uuid(),
  bar_id      uuid not null references bars(id) on delete cascade,
  name        text not null,
  slug        text not null,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique(bar_id, slug)
);

create table menu_items (
  id            uuid primary key default gen_random_uuid(),
  category_id   uuid not null references menu_categories(id) on delete cascade,
  name          text not null,
  description   text,
  price         int not null check (price >= 0),
  image_url     text,
  tags          text[] default '{}',
  is_available  boolean not null default true,
  prep_minutes  int default 5,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

create index idx_menu_items_category on menu_items (category_id);

-- ============================================================
-- ORDERS
-- ============================================================
create table orders (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references table_sessions(id) on delete cascade,
  status      order_status not null default 'open',
  created_at  timestamptz not null default now(),
  closed_at   timestamptz
);

-- Hanya 1 order open per session
create unique index uniq_open_order_per_session
  on orders (session_id)
  where status <> 'closed';

create table order_items (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references orders(id) on delete cascade,
  menu_item_id          uuid not null references menu_items(id) on delete restrict,
  added_by_member_id    uuid not null references session_members(id) on delete restrict,
  quantity              int not null default 1 check (quantity > 0),
  unit_price            int not null check (unit_price >= 0),
  notes                 text,
  status                order_item_status not null default 'draft',
  created_at            timestamptz not null default now(),
  served_at             timestamptz
);

create index idx_order_items_order on order_items (order_id);
create index idx_order_items_member on order_items (added_by_member_id);

-- ============================================================
-- PAYMENTS
-- ============================================================
create table payments (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references orders(id) on delete cascade,
  paid_by_member_id     uuid not null references session_members(id) on delete restrict,
  amount                int not null check (amount > 0),
  method                payment_method not null default 'mock',
  status                payment_status not null default 'pending',
  split_mode            split_mode not null default 'equal',
  split_meta            jsonb default '{}'::jsonb,
  paid_at               timestamptz,
  external_ref          text,
  created_at            timestamptz not null default now()
);

create index idx_payments_order on payments (order_id);
create index idx_payments_member on payments (paid_by_member_id);

-- ============================================================
-- STAFF ROLES
-- ============================================================
create table staff_roles (
  id          uuid primary key default gen_random_uuid(),
  bar_id      uuid not null references bars(id) on delete cascade,
  profile_id  uuid not null references profiles(id) on delete cascade,
  role        staff_role not null default 'waiter',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique(bar_id, profile_id, role)
);

-- ============================================================
-- HELPER VIEWS
-- ============================================================

-- View: active sessions dengan host info & member count
create or replace view v_active_sessions as
select
  ts.id,
  ts.table_id,
  t.label as table_label,
  t.area_id,
  fa.name as area_name,
  ts.status,
  ts.visibility,
  ts.title,
  ts.vibe_tags,
  ts.host_id,
  p.display_name as host_name,
  p.avatar_url as host_avatar,
  ts.started_at,
  (select count(*) from session_members sm
    where sm.session_id = ts.id and sm.status = 'joined') as member_count,
  t.capacity as table_capacity
from table_sessions ts
join tables t on t.id = ts.table_id
join floor_areas fa on fa.id = t.area_id
join profiles p on p.id = ts.host_id
where ts.status in ('open', 'locked');

-- View: order summary per session
create or replace view v_session_bill as
select
  o.id as order_id,
  o.session_id,
  o.status as order_status,
  coalesce(sum(oi.quantity * oi.unit_price), 0) as subtotal,
  count(oi.id) as item_count
from orders o
left join order_items oi on oi.order_id = o.id and oi.status <> 'void'
group by o.id;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table profiles            enable row level security;
alter table bars                enable row level security;
alter table floor_areas         enable row level security;
alter table tables              enable row level security;
alter table table_sessions      enable row level security;
alter table session_members     enable row level security;
alter table session_invites     enable row level security;
alter table menu_categories     enable row level security;
alter table menu_items          enable row level security;
alter table orders              enable row level security;
alter table order_items         enable row level security;
alter table payments            enable row level security;
alter table staff_roles         enable row level security;

-- PROFILES
create policy "profiles_read_all"     on profiles for select using (true);
create policy "profiles_update_own"   on profiles for update using (auth.uid() = id);
create policy "profiles_insert_own"   on profiles for insert with check (auth.uid() = id);

-- BARS / FLOOR_AREAS / TABLES / MENU — public read
create policy "bars_read"             on bars for select using (true);
create policy "floor_areas_read"      on floor_areas for select using (true);
create policy "tables_read"           on tables for select using (true);
create policy "menu_categories_read"  on menu_categories for select using (true);
create policy "menu_items_read"       on menu_items for select using (true);

-- TABLE SESSIONS — read sesuai visibility
create policy "sessions_read_public" on table_sessions for select
  using (
    visibility = 'public'
    or host_id = auth.uid()
    or exists (
      select 1 from session_members sm
      where sm.session_id = table_sessions.id and sm.profile_id = auth.uid()
    )
  );

create policy "sessions_insert_authenticated" on table_sessions for insert
  with check (host_id = auth.uid());

create policy "sessions_update_host" on table_sessions for update
  using (host_id = auth.uid());

-- SESSION MEMBERS
create policy "members_read_by_session_members" on session_members for select
  using (
    profile_id = auth.uid()
    or exists (
      select 1 from session_members sm2
      where sm2.session_id = session_members.session_id
        and sm2.profile_id = auth.uid()
    )
    or exists (
      select 1 from table_sessions ts
      where ts.id = session_members.session_id and ts.host_id = auth.uid()
    )
  );

create policy "members_insert_self" on session_members for insert
  with check (profile_id = auth.uid());

create policy "members_update_host_or_self" on session_members for update
  using (
    profile_id = auth.uid()
    or exists (
      select 1 from table_sessions ts
      where ts.id = session_members.session_id and ts.host_id = auth.uid()
    )
  );

-- SESSION INVITES
create policy "invites_read_session_members" on session_invites for select
  using (
    created_by = auth.uid()
    or exists (
      select 1 from session_members sm
      where sm.session_id = session_invites.session_id
        and sm.profile_id = auth.uid()
    )
  );

create policy "invites_insert_session_member" on session_invites for insert
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from session_members sm
      where sm.session_id = session_invites.session_id
        and sm.profile_id = auth.uid()
        and sm.role in ('host', 'member')
    )
  );

-- ORDERS / ORDER ITEMS — hanya members & staff
create policy "orders_read_member" on orders for select
  using (
    exists (
      select 1 from session_members sm
      where sm.session_id = orders.session_id
        and sm.profile_id = auth.uid()
    )
  );

create policy "orders_insert_member" on orders for insert
  with check (
    exists (
      select 1 from session_members sm
      where sm.session_id = orders.session_id
        and sm.profile_id = auth.uid()
    )
  );

create policy "orders_update_member" on orders for update
  using (
    exists (
      select 1 from session_members sm
      where sm.session_id = orders.session_id
        and sm.profile_id = auth.uid()
    )
  );

create policy "order_items_read_member" on order_items for select
  using (
    exists (
      select 1 from orders o
      join session_members sm on sm.session_id = o.session_id
      where o.id = order_items.order_id and sm.profile_id = auth.uid()
    )
  );

create policy "order_items_insert_member" on order_items for insert
  with check (
    exists (
      select 1 from session_members sm
      where sm.id = order_items.added_by_member_id
        and sm.profile_id = auth.uid()
    )
  );

create policy "order_items_update_member" on order_items for update
  using (
    exists (
      select 1 from orders o
      join session_members sm on sm.session_id = o.session_id
      where o.id = order_items.order_id and sm.profile_id = auth.uid()
    )
  );

-- PAYMENTS
create policy "payments_read_member" on payments for select
  using (
    exists (
      select 1 from orders o
      join session_members sm on sm.session_id = o.session_id
      where o.id = payments.order_id and sm.profile_id = auth.uid()
    )
  );

create policy "payments_insert_self" on payments for insert
  with check (
    exists (
      select 1 from session_members sm
      where sm.id = payments.paid_by_member_id
        and sm.profile_id = auth.uid()
    )
  );

-- STAFF — hanya self read
create policy "staff_read_self" on staff_roles for select
  using (profile_id = auth.uid());

-- ============================================================
-- REALTIME — enable replication
-- ============================================================
alter publication supabase_realtime add table table_sessions;
alter publication supabase_realtime add table session_members;
alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table order_items;
alter publication supabase_realtime add table payments;
