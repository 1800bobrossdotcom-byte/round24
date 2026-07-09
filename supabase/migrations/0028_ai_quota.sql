-- ============================================================
-- Caliper — schema v28: per-org daily quota for the AI edge functions.
-- receipt-ocr / chat-summary / stock-check all hit Claude Opus and were callable
-- without limit by any member → unbounded Anthropic spend (Blue #1 / Red #7).
-- ai_quota_bump atomically increments today's counter for the caller's org and
-- reports whether they're still under the cap. Definer-only; RLS-locked table.
-- ============================================================

create table if not exists ai_usage (
  org_id uuid not null references orgs(id) on delete cascade,
  day    date not null default current_date,
  calls  int  not null default 0,
  primary key (org_id, day)
);
alter table ai_usage enable row level security;  -- no policies: only the definer fn touches it

create or replace function ai_quota_bump(p_limit int default 200)
returns table(allowed boolean, used int)
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_calls int;
begin
  select org_id into v_org from memberships where user_id = auth.uid() order by created_at limit 1;
  if v_org is null then return query select false, 0; return; end if;
  insert into ai_usage(org_id, day, calls) values (v_org, current_date, 1)
    on conflict (org_id, day) do update set calls = ai_usage.calls + 1
    returning calls into v_calls;
  return query select (v_calls <= p_limit), v_calls;
end $$;
grant execute on function ai_quota_bump(int) to authenticated;
