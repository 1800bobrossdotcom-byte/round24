-- ============================================================
-- Caliper — schema v20: document (non-image) attachments
-- Photos already live on work_orders.photos / messages.image_path.
-- This adds PDFs & other files alongside them: a jsonb list of
-- {path,name} on a work order, and a single file (path + original
-- name) on a chat message. Same private 'attachments' bucket.
-- ============================================================

alter table work_orders add column if not exists files jsonb not null default '[]';
alter table messages    add column if not exists file_path text;
alter table messages    add column if not exists file_name text;
