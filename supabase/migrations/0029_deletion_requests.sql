-- ============================================================
-- Round24 — schema v29: real account-deletion / erasure requests (White #2).
-- Previously "Request account deletion" only wrote a flag into the user's own
-- settings that nothing read — a dead end vs. the Terms/Privacy promise. Now it
-- lands in a server-side table the platform admin can see and process.
-- ============================================================

create table if not exists deletion_requests (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  email        text,
  note         text,
  status       text default 'pending',   -- pending | resolved
  requested_at timestamptz default now(),
  resolved_at  timestamptz
);
alter table deletion_requests enable row level security;

-- a user may file and see their own request
drop policy if exists dr_own on deletion_requests;
create policy dr_own on deletion_requests for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- platform admins may read and resolve every request
drop policy if exists dr_admin_read on deletion_requests;
create policy dr_admin_read on deletion_requests for select using (is_platform_admin());
drop policy if exists dr_admin_update on deletion_requests;
create policy dr_admin_update on deletion_requests for update
  using (is_platform_admin()) with check (is_platform_admin());

-- file (or re-file) the caller's erasure request
create or replace function request_account_deletion(p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into deletion_requests(user_id, email, note)
  values (auth.uid(), auth.jwt() ->> 'email', p_note)
  on conflict (user_id) do update set requested_at = now(), note = excluded.note, status = 'pending', resolved_at = null;
end $$;
grant execute on function request_account_deletion(text) to authenticated;
