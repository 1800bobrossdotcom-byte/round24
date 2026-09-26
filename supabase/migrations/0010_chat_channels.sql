-- ============================================================
-- Round24 — schema v10: 1:1 DMs + named group chats
-- Small operations want to message one person or a small group, not just
-- the whole team. Adds a members directory (so you can pick who to message)
-- and private channels (members-only). Team ('all') and per-work-order
-- ('wo:<id>') channels stay org-wide; private channels use id 'ch:<uuid>'.
-- ============================================================

-- directory of app users per org — populated as people use the app, so the
-- "start a conversation" picker knows who's reachable.
create table chat_members (
  org_id     uuid not null references orgs(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  label      text,
  role       text,
  updated_at timestamptz default now(),
  primary key (org_id, user_id)
);
alter table chat_members enable row level security;
create policy cm_read on chat_members for select
  using (org_id in (select current_user_orgs()));
create policy cm_upsert on chat_members for insert
  with check (org_id in (select current_user_orgs()) and user_id = auth.uid());
create policy cm_update on chat_members for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- private channels: dm (2 people) or group (named, N people)
create table chat_channels (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references orgs(id) on delete cascade,
  kind          text not null check (kind in ('dm', 'group')),
  name          text,                                   -- group name; null for dm
  member_ids    uuid[] not null default '{}',
  member_labels text[] not null default '{}',
  created_by    uuid references auth.users(id) default auth.uid(),
  created_at    timestamptz default now()
);
alter table chat_channels enable row level security;
create policy cc_member_read on chat_channels for select
  using (org_id in (select current_user_orgs()) and auth.uid() = any(member_ids));
create policy cc_insert on chat_channels for insert
  with check (org_id in (select current_user_orgs()) and created_by = auth.uid() and auth.uid() = any(member_ids));

-- tighten message visibility: team + work-order channels are org-wide, but a
-- private 'ch:<id>' channel is readable/writable only by its members.
drop policy if exists msg_read on messages;
create policy msg_read on messages for select using (
  org_id in (select current_user_orgs()) and (
    channel = 'all' or channel like 'wo:%'
    or exists (select 1 from chat_channels c
               where 'ch:' || c.id::text = messages.channel and auth.uid() = any(c.member_ids))
  )
);

drop policy if exists msg_insert on messages;
create policy msg_insert on messages for insert with check (
  org_id in (select current_user_orgs()) and sender_id = auth.uid() and (
    channel = 'all' or channel like 'wo:%'
    or exists (select 1 from chat_channels c
               where 'ch:' || c.id::text = messages.channel and auth.uid() = any(c.member_ids))
  )
);

alter publication supabase_realtime add table chat_channels;
