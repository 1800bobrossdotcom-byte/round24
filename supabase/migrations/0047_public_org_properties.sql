-- ============================================================
-- Round24 — schema v47: public property list for the resident request form
-- The resident page (unauthenticated) should offer a dropdown of the org's real
-- buildings instead of free-typed addresses, so every request lands on a known
-- property — streamlined, matchable data straight into the office queue. Like
-- get_org_branding, this is a narrow security-definer read (building NAMES only,
-- nothing sensitive) granted to anon; the office chooses to expose it by posting
-- the resident link publicly.
-- ============================================================

create or replace function get_org_properties(p_org_id uuid)
returns table(name text)
language sql stable security definer set search_path = public as $$
  select p.name
  from properties p
  where p.org_id = p_org_id
    and coalesce(trim(p.name), '') <> ''
    and coalesce(lower(trim(p.city)), '') <> 'overhead'   -- hide the labor-overhead bucket ("Office")
  order by p.name;
$$;
grant execute on function get_org_properties(uuid) to anon, authenticated;
