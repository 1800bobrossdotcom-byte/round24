-- ============================================================
-- Caliper — schema v19: photo attachments
-- Photos on work orders (crew documents the job) and images in chat.
-- Both live in one private 'attachments' bucket, object paths
-- '<org_id>/<file>', readable/writable by any member of that org
-- (same model as voicenotes). Work-order photos are a text[] of paths
-- on the row; a chat image is a single path on the message.
-- ============================================================

alter table work_orders add column if not exists photos text[] not null default '{}';
alter table messages    add column if not exists image_path text;

-- shared private bucket for work-order photos and chat images
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

create policy "attachments upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (split_part(name, '/', 1))::uuid in (select current_user_orgs())
  );
create policy "attachments read" on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and (split_part(name, '/', 1))::uuid in (select current_user_orgs())
  );
create policy "attachments delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (split_part(name, '/', 1))::uuid in (select current_user_orgs())
  );
