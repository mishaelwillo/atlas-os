-- ATLAS OS — 0012: pilot cost and outcome record (P2C-REVENUE-001)
-- Owning specification: docs/specs/p2/revenue-pilot.md
--
-- Applied state lives in docs/control/ENVIRONMENTS.yaml (expected_migration),
-- which the drift collector compares against the live migration ledger. This
-- file records intent and coupling only: it cannot know its own history.
--
-- COUPLING: applying this requires bumping expected_migration to
-- 0012_pilot_cost_and_outcome, adding both tables to required_tables, and
-- updating ATLAS_SCHEMA_VERSION on both Railway services — or the fingerprints
-- keep claiming 0011 and `pnpm control:status` reports blocking drift.
--
-- COUPLING: the permitted categories below must stay identical to
-- `COST_CATEGORIES` in apps/api/src/revenue/pilot-record.ts. They are written
-- out here rather than left to the application because a category nobody
-- defined is exactly the kind of value that reaches a column unnoticed.
--
-- Strictly additive: two new tables. No existing column, row or policy is
-- altered.
--
-- WHY: P2C's exit criterion is "one paying customer AND complete cost/support/
-- outcome record". The second half has never been buildable — `funnel.ts`
-- names six metrics nothing records (provider_cost, labour_cost, support_time,
-- satisfaction, time_per_stage, demo_cost) and reports them as unavailable
-- rather than as zero, precisely so the gap could not be mistaken for a
-- measurement. These tables close four of them; time_per_stage is derived from
-- timestamps the pilot already writes, and gross margin is derived from the
-- rest.
--
-- WHY money and time are separate columns, exactly one of them set: labour and
-- support are naturally hours, provider and demo are naturally money, and an
-- hourly rate that would let them be summed is a number nobody has supplied.
-- Inventing one would produce a gross margin that looks authoritative and is
-- made up — the same reason offers refuse a default price. The check constraint
-- makes "both" and "neither" unrepresentable rather than merely discouraged.

create table if not exists pilot_cost_entries (
  entry_id      uuid primary key default gen_random_uuid(),
  space_id      uuid not null references spaces(space_id) on delete cascade,
  -- Null means the cost is real but not attributable to one customer — a
  -- monthly provider bill, say. Counted in the pilot total, excluded from
  -- per-customer cost, because splitting it would invent an allocation.
  lead_id       uuid references leads(lead_id) on delete cascade,
  category      text not null
                check (category in ('provider', 'labour', 'support', 'demo')),
  amount_minor  integer check (amount_minor >= 0),
  currency      text,
  minutes       integer check (minutes >= 0),
  incurred_on   date not null,
  -- Free text, required: a cost with no description cannot be audited later,
  -- and the pilot's whole purpose is producing a record someone can check.
  note          text not null check (length(btrim(note)) > 0),
  recorded_by   text not null,
  created_at    timestamptz not null default now(),
  -- Exactly one of money or time. Money needs a currency; mixed currencies are
  -- never summed anywhere in the funnel, so the currency has to travel with it.
  constraint pilot_cost_money_or_time check (
    (amount_minor is not null and currency is not null and minutes is null)
    or (minutes is not null and amount_minor is null and currency is null)
  )
);

create index if not exists pilot_cost_entries_space_idx
  on pilot_cost_entries (space_id, category);
create index if not exists pilot_cost_entries_lead_idx
  on pilot_cost_entries (lead_id) where lead_id is not null;

-- WHY a separate table: satisfaction is an outcome observed from the customer,
-- not a cost incurred by us. Folding it into the cost table would need a row
-- that is neither money nor time, which the constraint above rightly forbids.
create table if not exists pilot_outcomes (
  outcome_id    uuid primary key default gen_random_uuid(),
  space_id      uuid not null references spaces(space_id) on delete cascade,
  lead_id       uuid not null references leads(lead_id) on delete cascade,
  -- One to five. Deliberately not defaulted: an unrecorded satisfaction is a
  -- gap in the record, and a default would fill it with a number nobody gave.
  satisfaction  smallint not null check (satisfaction between 1 and 5),
  observed_on   date not null,
  note          text not null check (length(btrim(note)) > 0),
  recorded_by   text not null,
  created_at    timestamptz not null default now()
);

create index if not exists pilot_outcomes_lead_idx on pilot_outcomes (lead_id);

-- The ledger insert is the final statement, so the migration self-records only
-- if everything above succeeded. 0003 skipped this and the ledger drifted a
-- version behind until someone noticed.
insert into supabase_migrations.schema_migrations (version, name)
values ('0012', '0012_pilot_cost_and_outcome')
on conflict (version) do nothing;
