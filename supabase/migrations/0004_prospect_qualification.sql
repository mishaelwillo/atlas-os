-- ATLAS OS — 0004: prospect qualification and the demo queue (P2C-REVENUE-001)
-- Owning specification: docs/specs/p2/revenue-pilot.md
--
-- REVIEW ONLY — NOT APPLIED. No database has run this file.
--
-- COUPLING: docs/control/ENVIRONMENTS.yaml pins expected_migration. Applying
-- this requires bumping it to 0004_prospect_qualification in the same approved
-- change, adding both tables to required_tables, and updating
-- ATLAS_SCHEMA_VERSION on both Railway services — or their fingerprints keep
-- claiming 0003 and the next `pnpm control:status` reports blocking drift.
--
-- Strictly additive: two new tables plus indexes and policies. No existing
-- table, column, row or policy is altered. In particular `leads.status` is
-- untouched: it is the outreach lifecycle, and a qualification verdict is a
-- different axis. Writing one onto the other would let a disqualification
-- overwrite a suppression, which is the one lead state that must never be lost.
--
-- Until this runs, the capabilities that read these tables report
-- `schema_pending` and change nothing, rather than failing as a server error.

-- ---------- qualification assessments ----------
-- Append-only. Re-assessing a prospect inserts a new row; the latest one by
-- created_at is the standing verdict. History is kept because the pilot's
-- exit criteria require recording why prospects were rejected, and because an
-- assessment that expired is evidence, not noise.
create table if not exists qualification_assessments (
  assessment_id  uuid primary key default gen_random_uuid(),
  space_id       uuid not null references spaces on delete cascade,
  lead_id        uuid not null references leads on delete cascade,
  -- Cohort this prospect was assessed against; the pilot runs one at a time.
  region         text not null,
  vertical       text not null,
  -- Bumped when the rubric itself changes, so an old verdict is not silently
  -- compared against new rules.
  rubric_version integer not null default 1,
  verdict        text not null
                 check (verdict in ('qualified', 'disqualified', 'eligibility_review')),
  -- 0–30 across the six dimensions the specification names.
  total          integer not null check (total >= 0 and total <= 30),
  scores         jsonb not null default '{}',
  -- Settled facts that disqualify.
  blockers       jsonb not null default '[]',
  -- Questions nobody has answered yet; these send a prospect to review.
  unknowns       jsonb not null default '[]',
  -- The evidence the verdict was derived from, so it can be recomputed and
  -- checked rather than taken on trust.
  evidence       jsonb not null default '{}',
  -- Named human. Models may suggest candidates; an operator qualifies.
  assessed_by    text not null,
  -- Sourced facts go stale; an expired assessment cannot take a demo slot.
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now()
);

comment on table qualification_assessments is
  'Append-only prospect assessments. The latest row per lead is the standing verdict.';
comment on column qualification_assessments.evidence is
  'Inputs the verdict was derived from, so a stored verdict can be recomputed.';

create index if not exists qualification_latest
  on qualification_assessments (lead_id, created_at desc);

create index if not exists qualification_space
  on qualification_assessments (space_id, verdict, created_at desc);

alter table qualification_assessments enable row level security;

-- Mirrors the space-scoped policy pattern established in 0001 for tenant data.
create policy qualification_operator on qualification_assessments
  for all using (is_operator()) with check (is_operator());
create policy qualification_space on qualification_assessments
  for select using (space_id = current_space());

-- ---------- demo queue ----------
-- One row per demo slot. The 5–10 cap the specification requires is enforced
-- in the capability, and the partial unique index below makes the "one active
-- slot per prospect" half of it true in the database as well, so a concurrent
-- pair of requests cannot both pass the check.
create table if not exists demo_queue (
  queue_id       uuid primary key default gen_random_uuid(),
  space_id       uuid not null references spaces on delete cascade,
  lead_id        uuid not null references leads on delete cascade,
  -- Set once the factory has built something for this slot.
  site_id        uuid references sites on delete set null,
  -- queued → building → qa → approved → shareable, with expired reachable
  -- from anything not yet shareable. Transitions only move forward.
  state          text not null default 'queued'
                 check (state in ('queued', 'building', 'qa', 'approved', 'shareable', 'expired')),
  -- The assessment that admitted this prospect, so the slot stays traceable to
  -- the verdict that justified it.
  assessment_id  uuid references qualification_assessments on delete set null,
  queued_by      text not null,
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on column demo_queue.assessment_id is
  'The qualification that admitted this prospect to a slot.';

-- One active slot per prospect. Expired slots are excluded so a prospect can
-- be re-queued after a demo goes stale.
create unique index if not exists demo_queue_one_active_per_lead
  on demo_queue (lead_id)
  where state <> 'expired';

create index if not exists demo_queue_space_state
  on demo_queue (space_id, state, created_at desc);

alter table demo_queue enable row level security;

create policy demo_queue_operator on demo_queue
  for all using (is_operator()) with check (is_operator());
create policy demo_queue_space on demo_queue
  for select using (space_id = current_space());

-- The ledger is the control plane's only proof of schema identity. A migration
-- that does not self-record leaves the schema ahead of the ledger, and because
-- the drift check reads the ledger the mismatch is silent.
insert into supabase_migrations.schema_migrations (version, name)
values ('0004', 'prospect_qualification')
on conflict (version) do nothing;
