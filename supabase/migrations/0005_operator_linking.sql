-- ============================================================
-- Round24 — schema v5: operator display names + assignment linking
-- Work orders are assigned by display label in the UI; RLS grants a
-- tech visibility by operator id. This bridges the two: a plaintext
-- crew handle (display_name) resolves labels to operator ids on
-- insert/update. Full legal name / PII stays in name_enc (encrypted);
-- pay rates remain encrypted regardless.
-- ============================================================

alter table operators add column display_name text;
alter table operators alter column name_enc drop not null;

-- resolve assignee_label → assigned_operator_id (case-insensitive)
create or replace function resolve_wo_assignee()
returns trigger language plpgsql security definer as $$
begin
  if new.assigned_operator_id is null and new.assignee_label is not null then
    select id into new.assigned_operator_id from operators
    where org_id = new.org_id
      and display_name is not null
      and lower(display_name) = lower(new.assignee_label)
    limit 1;
  end if;
  return new;
end $$;

create trigger wo_resolve_assignee
  before insert or update on work_orders
  for each row execute function resolve_wo_assignee();

-- backfill any existing labeled-but-unlinked work orders
update work_orders wo
set assigned_operator_id = o.id
from operators o
where wo.assigned_operator_id is null
  and wo.assignee_label is not null
  and o.org_id = wo.org_id
  and lower(o.display_name) = lower(wo.assignee_label);
