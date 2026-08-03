-- ATLAS OS — 0005: outreach sequence state (P2C-REVENUE-001)
-- Owning specification: docs/specs/p2/revenue-pilot.md
--
-- Applied state lives in docs/control/ENVIRONMENTS.yaml (expected_migration),
-- which the drift collector compares against the live migration ledger. This
-- file records intent and coupling only: it cannot know its own history, and
-- the banner that used to claim otherwise went stale the moment it ran.
--
-- COUPLING: applying this requires bumping expected_migration to
-- 0005_outreach_sequences, adding both tables to required_tables, and updating
-- ATLAS_SCHEMA_VERSION on both Railway services — or the fingerprints keep
-- claiming 0004 and `pnpm control:status` reports blocking drift.
--
-- Strictly additive: two new tables plus indexes and policies. No existing
-- table, column, row or policy is altered.
--
-- WHAT THIS DELIBERATELY DOES NOT DO: a sequence cannot send. The only path to
-- a touch being `sent` is the approval-gated outreach.send dispatcher, and the
-- only path to `approved` is a real approvals row, referenced below. Storing
-- sequence state must not become a way to record outbound effects that never
-- passed an approval.

-- ---------- sequences ----------
-- One open sequence per lead. `state` is derived from the touches in the
-- application and stored here only as a summary for listing; the touches
-- remain the authority for what actually happened.
create table if not exists outreach_sequences (
  sequence_id   uuid primary key default gen_random_uuid(),
  space_id      uuid not null references spaces on delete cascade,
  lead_id       uuid not null references leads on delete cascade,
  -- Bumped when a lead is sequenced again after an earlier one stopped, so the
  -- history of what was attempted stays readable.
  version       integer not null default 1,
  state         text not null default 'planned'
                check (state in ('planned', 'active', 'stopped', 'completed')),
  -- Why the plan ended: a reply, an opt-out, or every touch resolved.
  stopped_reason text,
  planned_by    text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (lead_id, version)
);

comment on column outreach_sequences.state is
  'Summary derived from the touches; outreach_touches is the authority.';

-- One sequence per lead may be open at a time. A stopped or completed one does
-- not occupy the slot, so a lead can be sequenced again later.
create unique index if not exists outreach_sequences_one_open_per_lead
  on outreach_sequences (lead_id)
  where state in ('planned', 'active');

create index if not exists outreach_sequences_space
  on outreach_sequences (space_id, state, created_at desc);

alter table outreach_sequences enable row level security;

-- Mirrors the space-scoped policy pattern established in 0001 for tenant data.
create policy outreach_sequences_operator on outreach_sequences
  for all using (is_operator()) with check (is_operator());
create policy outreach_sequences_space on outreach_sequences
  for select using (space_id = current_space());

-- ---------- touches ----------
-- draft → policy_check → approval_required → approved → scheduled → sent
--       → delivered|failed → replied|no_reply|suppressed
create table if not exists outreach_touches (
  touch_id      uuid primary key default gen_random_uuid(),
  space_id      uuid not null references spaces on delete cascade,
  sequence_id   uuid not null references outreach_sequences on delete cascade,
  lead_id       uuid not null references leads on delete cascade,
  step          integer not null,
  channel       text not null
                check (channel in ('email', 'sms', 'whatsapp', 'social_dm', 'phone')),
  state         text not null default 'draft'
                check (state in ('draft', 'policy_check', 'approval_required', 'approved',
                                 'scheduled', 'sent', 'delivered', 'failed',
                                 'replied', 'no_reply', 'suppressed')),
  -- The approval that permitted this specific touch. Approval is specific to
  -- recipient, channel, content hash and send window, so it belongs on the
  -- touch and not on the sequence.
  approval_id   uuid references approvals on delete set null,
  -- sha256 of the approved body. An edit after approval changes this, so a
  -- touch cannot be sent carrying content nobody approved.
  content_hash  text,
  scheduled_for timestamptz,
  sent_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (sequence_id, step)
);

comment on column outreach_touches.approval_id is
  'The specific approval that permitted this touch; required before it can be approved.';
comment on column outreach_touches.content_hash is
  'sha256 of the approved body, so an edit after approval is detectable.';

-- Only one touch per sequence may be in flight. A touch that is still a draft
-- has not started, and a terminal one is finished; everything between occupies
-- the slot, which is what makes per-touch eligibility meaningful.
create unique index if not exists outreach_touches_one_in_flight
  on outreach_touches (sequence_id)
  where state in ('policy_check', 'approval_required', 'approved', 'scheduled', 'sent', 'delivered');

create index if not exists outreach_touches_sequence_step
  on outreach_touches (sequence_id, step);

create index if not exists outreach_touches_space
  on outreach_touches (space_id, state, created_at desc);

alter table outreach_touches enable row level security;

create policy outreach_touches_operator on outreach_touches
  for all using (is_operator()) with check (is_operator());
create policy outreach_touches_space on outreach_touches
  for select using (space_id = current_space());

-- The ledger is the control plane's only proof of schema identity. A migration
-- that does not self-record leaves the schema ahead of the ledger, and because
-- the drift check reads the ledger the mismatch is silent.
insert into supabase_migrations.schema_migrations (version, name)
values ('0005', 'outreach_sequences')
on conflict (version) do nothing;
