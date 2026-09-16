-- ============================================================
-- Caliper — schema v57: Web Push.
--   push_subscriptions — one row per device endpoint, owned by its user (RLS)
--   push_config        — where the push-send function lives + the shared secret
--                        (definer-only: no policies, read by the trigger below)
--   notify_push()      — AFTER-row trigger on the tables that ping people; posts
--                        a trimmed event to push-send via pg_net. Silently a
--                        no-op until push_config is filled in, and never blocks
--                        the write if the request fails.
-- Setup steps (keys, secrets, config rows) are in docs/PUSH-SETUP.md.
-- ============================================================

create table if not exists push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  org_id       uuid references orgs(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists push_subs_user on push_subscriptions(user_id);
create index if not exists push_subs_org  on push_subscriptions(org_id);
alter table push_subscriptions enable row level security;
drop policy if exists push_subs_own on push_subscriptions;
create policy push_subs_own on push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- sender location + secret. No policies: only the definer function (owner:
-- postgres) and the service role can read it.
create table if not exists push_config (
  key   text primary key,
  value text not null
);
alter table push_config enable row level security;

create extension if not exists pg_net;   -- lives in schema `net` (Dashboard → Database → Extensions if this line is refused)

-- one trimmed event → push-send. Heavy columns (data-URL photos, voice notes,
-- checklists, line items) never leave the database.
create or replace function notify_push()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text; v_secret text; v_new jsonb; v_old jsonb;
begin
  select value into v_url from push_config where key = 'url';
  select value into v_secret from push_config where key = 'secret';
  if v_url is null or v_secret is null then return null; end if;   -- push not configured yet

  v_new := to_jsonb(NEW) - 'photos' - 'files' - 'photo' - 'voice' - 'voice_transcript' - 'detail'
                         - 'line_items' - 'checklist' - 'voice_path' - 'tenant_contact';
  v_old := case when TG_OP = 'UPDATE'
                then to_jsonb(OLD) - 'photos' - 'files' - 'photo' - 'voice' - 'voice_transcript' - 'detail'
                                   - 'line_items' - 'checklist' - 'voice_path' - 'tenant_contact'
                else null end;
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('type', TG_OP, 'table', TG_TABLE_NAME, 'record', v_new, 'old_record', v_old,
                               'actor', auth.uid()),   -- who made the change (null from the public request form)
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    timeout_milliseconds := 5000
  );
  return null;
exception when others then
  return null;   -- a push hiccup must never fail the underlying write
end $$;
revoke all on function notify_push() from public, anon, authenticated;

drop trigger if exists push_work_orders on work_orders;
create trigger push_work_orders
  after insert or update of priority, status, assignee_label on work_orders
  for each row execute function notify_push();

drop trigger if exists push_maintenance_requests on maintenance_requests;
create trigger push_maintenance_requests
  after insert on maintenance_requests
  for each row execute function notify_push();

drop trigger if exists push_purchases on purchases;
create trigger push_purchases
  after insert or update of status on purchases
  for each row execute function notify_push();

drop trigger if exists push_messages on messages;
create trigger push_messages
  after insert on messages
  for each row execute function notify_push();
