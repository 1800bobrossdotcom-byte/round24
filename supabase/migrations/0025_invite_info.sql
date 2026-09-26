-- ============================================================
-- Round24 — schema v25: pre-auth invite lookup
-- Lets the login screen brand itself correctly BEFORE sign-in: an invite to an
-- owner workspace shows "Round24 Portfolio", a company one shows "Round24 Pro".
-- Returns only a workspace's kind + name for a still-valid invite code — no PII,
-- no membership data — so it's safe to expose to anon. SECURITY DEFINER because
-- invites/orgs are otherwise unreadable pre-auth.
-- ============================================================

create or replace function public.invite_info(p_code text)
returns table(valid boolean, kind text, org_name text)
language sql
security definer
set search_path = public
as $$
  select
    (i.id is not null and i.used_at is null and (i.expires_at is null or i.expires_at > now())) as valid,
    o.kind,
    o.name
  from invites i
  join orgs o on o.id = i.org_id
  where upper(i.code) = upper(trim(p_code))
  limit 1;
$$;

grant execute on function public.invite_info(text) to anon, authenticated;
