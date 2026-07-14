-- ============================================================
-- Caliper — schema v43: make-ready turn board + work-order checklists
-- Two "build our own RM module" surfaces:
--   1. unit_turns — the make-ready / turnover board. A unit goes vacant, moves
--      through stages (notice → vacant → make-ready → ready → leased), carries a
--      target ready-by date and a make-ready checklist. Office planning surface.
--   2. checklist_templates + work_orders.checklist — templated task lists. A
--      reusable template (e.g. "Standard turn", "HVAC PM") stamps its items onto
--      a work order or a turn; the crew checks them off as they go.
-- ============================================================

-- per-work-order checklist instance: [{ id, text, done, doneAt }]
alter table work_orders add column if not exists checklist jsonb;

-- reusable, named checklists shared by work orders and turns
create table if not exists checklist_templates (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs(id) on delete cascade,
  name        text not null,
  kind        text not null default 'any' check (kind in ('any','workorder','turn')),
  category    text,
  items       jsonb not null default '[]'::jsonb,   -- array of item strings
  created_by  uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz default now()
);
create index if not exists cl_tmpl_org on checklist_templates(org_id);

alter table checklist_templates enable row level security;
drop policy if exists cl_tmpl_staff on checklist_templates;
create policy cl_tmpl_staff on checklist_templates for all
  using (is_org_staff(org_id)) with check (is_org_staff(org_id));

-- the make-ready / turnover board
create table if not exists unit_turns (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references orgs(id) on delete cascade,
  property_label text,
  unit           text,
  stage          text not null default 'notice'
                 check (stage in ('notice','vacant','make_ready','ready','leased')),
  move_out       date,        -- current tenant out
  target_ready   date,        -- ready-to-lease goal
  actual_ready   date,        -- when it actually hit "ready"
  assignee_label text,
  market_rent    numeric,     -- turn is lost rent until leased; track the target
  checklist      jsonb,       -- make-ready checklist instance
  notes          text,
  work_order_id  uuid references work_orders(id) on delete set null,
  created_by     uuid references auth.users(id) default auth.uid(),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index if not exists turns_org_stage on unit_turns(org_id, stage);

alter table unit_turns enable row level security;
-- office planning surface (like maintenance_schedules); the work order a turn
-- spawns carries its own crew-facing RLS.
drop policy if exists turns_staff on unit_turns;
create policy turns_staff on unit_turns for all
  using (is_org_staff(org_id)) with check (is_org_staff(org_id));

do $$ begin alter publication supabase_realtime add table unit_turns; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table checklist_templates; exception when duplicate_object then null; end $$;
