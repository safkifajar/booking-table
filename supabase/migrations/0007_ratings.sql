-- ============================================================
-- MEMBER RATINGS
-- Rate antar member setelah session ditutup.
-- Visibility: agregat saja di profil (count + average + top tags).
-- ============================================================

create table member_ratings (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references table_sessions(id) on delete cascade,
  rater_id      uuid not null references profiles(id) on delete cascade,
  ratee_id      uuid not null references profiles(id) on delete cascade,
  stars         int not null check (stars between 1 and 5),
  tags          text[] default '{}',
  created_at    timestamptz not null default now(),
  -- Tidak boleh rate diri sendiri
  constraint no_self_rating check (rater_id <> ratee_id),
  -- Satu rater hanya bisa rate ratee sekali per session
  unique(session_id, rater_id, ratee_id)
);

create index idx_ratings_ratee on member_ratings (ratee_id);
create index idx_ratings_session on member_ratings (session_id);

-- ============================================================
-- VIEW: agregat rating per user
-- Dipakai di profile card untuk tampilkan avg star + top tags
-- ============================================================
create or replace view v_user_rating_summary as
select
  p.id as profile_id,
  p.display_name,
  coalesce(round(avg(r.stars)::numeric, 1), 0) as avg_stars,
  count(r.id)::int as rating_count,
  -- Top 3 tag berdasarkan frekuensi
  (
    select array_agg(tag order by cnt desc)
    from (
      select tag, count(*) as cnt
      from member_ratings mr
      cross join lateral unnest(mr.tags) as tag
      where mr.ratee_id = p.id
      group by tag
      order by cnt desc
      limit 3
    ) top_tags
  ) as top_tags
from profiles p
left join member_ratings r on r.ratee_id = p.id
group by p.id, p.display_name;

-- ============================================================
-- RLS
-- ============================================================
alter table member_ratings enable row level security;

-- Read: hanya bisa lihat rating yang KAMU berikan (untuk preview "sudah rate apa")
-- atau agregat via view (yang bypass RLS karena security definer? — no, view inherit caller's RLS)
-- Trick: agregat di-expose via function security definer
create policy "ratings_read_own"
  on member_ratings for select
  using (rater_id = auth.uid());

-- Insert: hanya bisa rate kalau:
--   1. Kamu adalah rater (auth.uid())
--   2. Session sudah closed
--   3. Kamu memang member dari session itu
--   4. Ratee juga member dari session itu
create policy "ratings_insert"
  on member_ratings for insert
  with check (
    rater_id = auth.uid()
    and is_session_member(session_id, auth.uid())
    and exists (
      select 1 from session_members sm
      where sm.session_id = member_ratings.session_id
        and sm.profile_id = member_ratings.ratee_id
    )
    and exists (
      select 1 from table_sessions ts
      where ts.id = member_ratings.session_id
        and ts.status = 'closed'
    )
  );

-- ============================================================
-- FUNCTION: get aggregate (security definer agar bisa di-call publicly)
-- ============================================================
create or replace function get_user_rating(p_profile_id uuid)
returns table (
  avg_stars numeric,
  rating_count int,
  top_tags text[]
)
language sql
security definer
stable
set search_path = public
as $$
  select
    coalesce(round(avg(stars)::numeric, 1), 0) as avg_stars,
    count(*)::int as rating_count,
    (
      select array_agg(tag order by cnt desc)
      from (
        select tag, count(*) as cnt
        from member_ratings mr
        cross join lateral unnest(mr.tags) as tag
        where mr.ratee_id = p_profile_id
        group by tag
        order by cnt desc
        limit 3
      ) t
    ) as top_tags
  from member_ratings
  where ratee_id = p_profile_id;
$$;

grant execute on function get_user_rating(uuid) to authenticated, anon;

-- ============================================================
-- FUNCTION: list ratable members for a session
-- (members other than self, where rater hasn't rated yet)
-- ============================================================
create or replace function get_ratable_members(p_session_id uuid)
returns table (
  member_id uuid,
  profile_id uuid,
  display_name text,
  avatar_url text,
  already_rated boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select
    sm.id as member_id,
    p.id as profile_id,
    p.display_name,
    p.avatar_url,
    exists (
      select 1 from member_ratings mr
      where mr.session_id = p_session_id
        and mr.rater_id = auth.uid()
        and mr.ratee_id = p.id
    ) as already_rated
  from session_members sm
  join profiles p on p.id = sm.profile_id
  where sm.session_id = p_session_id
    and sm.profile_id <> auth.uid()
    and sm.status in ('joined', 'left'); -- include yang sudah keluar tapi tadinya member
$$;

grant execute on function get_ratable_members(uuid) to authenticated;

-- Enable realtime for ratings (opsional, untuk live update saat someone rates you)
alter table member_ratings replica identity full;
alter publication supabase_realtime add table member_ratings;
