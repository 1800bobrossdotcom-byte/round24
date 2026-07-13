-- ============================================================
-- Caliper — schema v40: preventive / recurring maintenance schedules
-- The planned counterpart to work orders: "gutters quarterly at 121 Park",
-- "HVAC filters every 90 days". A schedule spawns a work order when it comes
-- due, so recurring upkeep stops living in someone's head. Office manages them;
-- the generated work orders flow to the crew like any other.
-- ============================================================

create table if not exists maintenance_schedules (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references orgs(id) on delete cascade,
  property_label       text,
  unit                 text,
  task                 text not null,
  detail               text,
  category             text default 'general',
  interval_days        int not null default 30,   -- cadence: 7 weekly, 30 monthly, 91 quarterly, 365 annual…
  next_due             date not null,             -- the next occurrence to generate a work order for
  assignee_label       text,
  priority             int default 3,
  active               boolean default true,
  last_generated       timestamptz,               -- when a work order was last spawned from this schedule
  created_by           uuid references auth.users(id) default auth.uid(),
  created_at           timestamptz default now()
);

create index if not exists maint_org on maintenance_schedules(org_id);
create index if not exists maint_due on maintenance_schedules(org_id, active, next_due);

alter table maintenance_schedules enable row level security;

-- staff manage the schedule; it's an office planning surface (the work orders it
-- spawns carry their own crew-facing RLS).
drop policy if exists maint_staff on maintenance_schedules;
create policy maint_staff on maintenance_schedules for all
  using (is_org_staff(org_id)) with check (is_org_staff(org_id));

do $$ begin alter publication supabase_realtime add table maintenance_schedules; exception when duplicate_object then null; end $$;
