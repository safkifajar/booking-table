-- ============================================================
-- GRANT STAFF ROLE
--
-- Jalankan untuk memberi role waiter ke user tertentu.
-- Cara: ganti email di bawah dengan email akun yang sudah signup.
-- ============================================================

-- Cara 1: berdasarkan email yang sudah signup
insert into staff_roles (bar_id, profile_id, role, is_active)
select
  (select id from bars where slug = 'soho-purwokerto'),
  u.id,
  'waiter',
  true
from auth.users u
where u.email = 'safkifajar07@gmail.com'  -- GANTI dengan email kamu
on conflict (bar_id, profile_id, role) do update set is_active = true;

-- Verifikasi
select
  sr.role,
  sr.is_active,
  p.display_name,
  u.email,
  b.name as bar
from staff_roles sr
join profiles p on p.id = sr.profile_id
join auth.users u on u.id = sr.profile_id
join bars b on b.id = sr.bar_id
where sr.is_active = true;
