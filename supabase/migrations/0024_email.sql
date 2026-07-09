-- ============================================================
-- Caliper — schema v24: email unsubscribe list
-- Records addresses that opted out of non-transactional email. The send
-- function honors it for welcome mail; the public /unsubscribe function
-- records it (one-click from the email footer). Locked table — only the
-- edge functions (service role) touch it.
-- ============================================================

create table if not exists email_unsub (
  email text primary key,
  at    timestamptz default now()
);
alter table email_unsub enable row level security;  -- no policies: service-role only
