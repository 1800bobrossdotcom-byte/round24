-- ============================================================
-- Caliper — schema v46: guardrails on the public intake endpoints (audit S4)
-- maintenance_requests and workspace_requests accept unauthenticated inserts by
-- design (resident repair form, beta-request funnel). Unbounded, that's a DB-
-- bloat / queue-spam vector: rows carry base64 photos, and nothing throttled a
-- hostile script. This adds (a) hard payload caps and (b) a per-IP + per-bucket
-- hourly rate limit, both enforced in triggers so no client can skip them.
-- Signed-in staff are never throttled — the guard applies to anon traffic.
-- ============================================================

-- rolling counters. No grants: the trigger fn is SECURITY DEFINER, so anon
-- never touches this table directly.
create table if not exists intake_hits (
  bucket       text not null,           -- e.g. 'mr:<org>' or 'wr'
  ip_hash      text not null,           -- md5 of caller ip ('noip' when absent)
  window_start timestamptz not null,    -- truncated to the hour
  n            int not null default 1,
  primary key (bucket, ip_hash, window_start)
);
alter table intake_hits enable row level security;  -- no policies: definer-only

-- increment + enforce. Raises (=> 4xx to the client) when either the caller's
-- IP or the whole bucket exceeds its hourly budget.
create or replace function intake_guard(p_bucket text, p_ip_limit int, p_bucket_limit int)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_ip text;
  v_win timestamptz := date_trunc('hour', now());
  v_ip_n int; v_bucket_n int;
begin
  -- caller ip via PostgREST's request.headers (first hop of x-forwarded-for);
  -- absent (non-REST paths) → a shared 'noip' bucket so the cap still holds.
  begin
    v_ip := split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), ',', 1);
  exception when others then v_ip := ''; end;
  v_ip := coalesce(nullif(trim(v_ip), ''), 'noip');

  insert into intake_hits(bucket, ip_hash, window_start)
  values (p_bucket, md5(v_ip), v_win)
  on conflict (bucket, ip_hash, window_start) do update set n = intake_hits.n + 1
  returning n into v_ip_n;

  select coalesce(sum(n), 0) into v_bucket_n from intake_hits
  where bucket = p_bucket and window_start = v_win;

  if v_ip_n > p_ip_limit or v_bucket_n > p_bucket_limit then
    raise exception 'rate limit exceeded — please try again later' using errcode = 'P0001';
  end if;

  -- opportunistic cleanup so the counter table can't grow unbounded
  if random() < 0.01 then
    delete from intake_hits where window_start < now() - interval '2 days';
  end if;
end $$;
revoke all on function intake_guard(text, int, int) from public, anon, authenticated;

-- ---- maintenance_requests: caps + 20/hr/IP + 120/hr/org (anon only) ----
create or replace function maintenance_requests_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then return new; end if;   -- staff/authed: untouched

  if new.description is null or length(new.description) not between 1 and 4000 then
    raise exception 'description must be 1–4000 characters';
  end if;
  if length(coalesce(new.property_label, '')) > 200 or length(coalesce(new.unit, '')) > 60
     or length(coalesce(new.tenant_name, '')) > 200 or length(coalesce(new.tenant_contact, '')) > 200 then
    raise exception 'field too long';
  end if;
  if length(coalesce(new.photo, '')) > 1500000 then raise exception 'photo too large'; end if;
  if length(coalesce(new.voice, '')) > 2000000 then raise exception 'voice note too large'; end if;
  if new.photos is not null then
    if jsonb_typeof(new.photos) <> 'array' or jsonb_array_length(new.photos) > 6 then
      raise exception 'photos must be an array of at most 6';
    end if;
    if exists (select 1 from jsonb_array_elements_text(new.photos) p where length(p) > 1500000) then
      raise exception 'a photo is too large';
    end if;
  end if;

  perform intake_guard('mr:' || new.org_id::text, 20, 120);
  return new;
end $$;
drop trigger if exists mr_guard on maintenance_requests;
create trigger mr_guard before insert on maintenance_requests
  for each row execute function maintenance_requests_guard();

-- ---- workspace_requests: caps + 5/hr/IP + 60/hr global (all inserts) ----
create or replace function workspace_requests_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if length(coalesce(new.email, '')) > 320 or length(coalesce(new.org_name, '')) > 200
     or length(coalesce(new.contact_name, '')) > 200 or length(coalesce(new.note, '')) > 2000 then
    raise exception 'field too long';
  end if;
  perform intake_guard('wr', 5, 60);
  return new;
end $$;
drop trigger if exists wr_guard on workspace_requests;
create trigger wr_guard before insert on workspace_requests
  for each row execute function workspace_requests_guard();
