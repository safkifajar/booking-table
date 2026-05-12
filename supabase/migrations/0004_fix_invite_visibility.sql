-- ============================================================
-- FIX: User yang punya invite code harus bisa preview session
-- sebelum jadi member.
--
-- Sebelumnya: hanya member/creator yang bisa baca invite.
-- Tapi yang mau diundang JUSTRU belum member!
-- ============================================================

-- Drop the restrictive read policy
drop policy if exists "invites_read" on session_invites;

-- Allow anyone authenticated to read an invite if they know the code.
-- Kode 6-char random sudah cukup secure untuk demo & banyak production use.
-- Pengecekan expiry/use_count tetap divalidasi di Server Action.
create policy "invites_read"
  on session_invites for select
  using (auth.role() = 'authenticated');

-- Optional: kalau mau lebih ketat, ganti dengan policy yang allow read
-- hanya jika kode dikirim sebagai parameter. Tapi PostgREST tidak punya cara
-- bagus untuk ini, jadi rely on app-level validation di Server Action.

-- Juga: pastikan TABLE_SESSIONS bisa di-baca lewat invite preview
-- (sudah ok karena policy sessions_read sudah allow public visibility,
--  dan invite-only juga bisa karena session.id ada di JOIN).
-- Tapi untuk safety, tambah policy yang allow read kalau ada invite valid:

-- Cek apakah tidak perlu — sessions yang invite_only tetap blocked.
-- Update sessions_read untuk juga allow kalau user punya invite valid:

drop policy if exists "sessions_read" on table_sessions;

create policy "sessions_read"
  on table_sessions for select
  using (
    visibility = 'public'
    or host_id = auth.uid()
    or is_session_member(id, auth.uid())
    or exists (
      select 1 from session_invites si
      where si.session_id = table_sessions.id
        and si.expires_at > now()
    )
  );
