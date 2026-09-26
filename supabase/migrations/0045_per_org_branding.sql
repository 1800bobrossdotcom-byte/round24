-- ============================================================
-- Round24 — schema v45: per-workspace branding (name + logo)
-- Branding stops being hardcoded. Each org carries its own logo in
-- orgs.theme.logo (name is already orgs.name). A public read exposes name+logo
-- to the unauthenticated resident page; org staff upload a logo to the
-- public-read brand-logos bucket and point their theme at it. A brand-new
-- workspace has an empty theme, so it shows the Round24 fallback and its own
-- name — nothing from another tenant carries over.
-- ============================================================

-- public branding (name + logo) by org id — for the pre-auth resident page,
-- which has no session to read orgs directly.
create or replace function get_org_branding(p_org_id uuid)
returns table(name text, logo text)
language sql stable security definer set search_path = public as $$
  select o.name, o.theme->>'logo' from orgs o where o.id = p_org_id;
$$;
grant execute on function get_org_branding(uuid) to anon, authenticated;

-- org staff (admin/manager) may update their own workspace's name + theme.
drop policy if exists orgs_staff_update on orgs;
create policy orgs_staff_update on orgs for update
  using (is_org_staff(id)) with check (is_org_staff(id));

-- org staff manage their logo file inside a folder named by their org id, in the
-- public-read brand-logos bucket.
drop policy if exists brandlogo_staff_write on storage.objects;
create policy brandlogo_staff_write on storage.objects for all to authenticated
  using (bucket_id = 'brand-logos' and is_org_staff(nullif((storage.foldername(name))[1], '')::uuid))
  with check (bucket_id = 'brand-logos' and is_org_staff(nullif((storage.foldername(name))[1], '')::uuid));

-- migrate Evolution24 off the code hardcode → its own theme.logo
update orgs set theme = coalesce(theme, '{}'::jsonb) || jsonb_build_object('logo', '/brands/evolution24.png?v=2')
where id = '10233d8a-0d9b-4f7d-9df7-65ef915c36f3';
