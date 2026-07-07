-- ============================================================
-- Caliper — schema v9: team comms (Slack-style) with voice notes
-- Two-way messaging across the org: office↔crew and crew↔crew. Every
-- org member can read and post to their org's channels. Messages are
-- typed notes and/or a voice note (audio in the 'voicenotes' bucket).
-- A message can be attached to a work order (channel 'wo:<id>') so a
-- thread becomes the job's running log.
-- ============================================================

create table messages (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  channel       text not null default 'all',        -- 'all' | 'wo:<work_order_id>'
  work_order_id uuid references work_orders(id) on delete set null,
  body          text,                               -- typed note (null if voice-only)
  voice_path    text,                               -- object path in 'voicenotes'
  voice_secs    int,                                -- note length for the UI
  sender_id     uuid references auth.users(id) default auth.uid(),
  sender_label  text,                               -- display name
  sender_role   text,                               -- office | crew (for styling)
  created_at    timestamptz default now()
);
alter table messages enable row level security;

-- everyone in the org reads the org's messages; you post as yourself
create policy msg_read on messages for select
  using (org_id in (select current_user_orgs()));
create policy msg_insert on messages for insert
  with check (org_id in (select current_user_orgs()) and sender_id = auth.uid());
-- sender may delete their own; staff may moderate
create policy msg_delete on messages for delete
  using (sender_id = auth.uid() or is_org_staff(org_id));

create index msg_org_channel on messages(org_id, channel, created_at);

-- live delivery to open apps (same mechanism as work-order realtime)
alter publication supabase_realtime add table messages;

-- ============================================================
-- STORAGE — private 'voicenotes' bucket; object paths '<org_id>/<file>'
-- Any org member may upload into their org folder and read the org's notes.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('voicenotes', 'voicenotes', false)
on conflict (id) do nothing;

create policy "voicenotes upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'voicenotes'
    and (split_part(name, '/', 1))::uuid in (select current_user_orgs())
  );
create policy "voicenotes read" on storage.objects for select to authenticated
  using (
    bucket_id = 'voicenotes'
    and (split_part(name, '/', 1))::uuid in (select current_user_orgs())
  );
