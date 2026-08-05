-- ATLAS OS — 0011: observed withdrawal verdict (P2B-FACTORY-001)
-- Owning specification: docs/specs/p2/website-factory.md
--
-- Applied state lives in docs/control/ENVIRONMENTS.yaml (expected_migration),
-- which the drift collector compares against the live migration ledger. This
-- file records intent and coupling only: it cannot know its own history.
--
-- COUPLING: applying this requires bumping expected_migration to
-- 0011_deployment_withdrawal_verdict and updating ATLAS_SCHEMA_VERSION on both
-- Railway services — or the fingerprints keep claiming 0010 and
-- `pnpm control:status` reports blocking drift. No new table, so
-- required_tables is unchanged.
--
-- COUPLING: the permitted verdicts below must stay identical to
-- `WithdrawalVerdict` in apps/api/src/factory/fingerprint.ts. They are written
-- out here rather than left to the application because a verdict nobody
-- defined is exactly the kind of value that reaches a column and is never
-- noticed.
--
-- Strictly additive: two nullable columns and one partial index on
-- site_deployments. No existing column, row or policy is altered, and every
-- historical row keeps a null verdict — which is the truth, because nothing
-- read those addresses back after they were withdrawn.
--
-- WHY: `status = 'unpublished'` records that Atlas told the provider to stop.
-- It does not record whether the public stopped receiving the site. Those are
-- different facts, and in the 2026-08-04 run they were apart for between
-- twenty and forty seconds — a withdrawal reported as complete while the
-- address was still serving. The dispatcher now reads the address back and
-- reaches a verdict, but has nowhere to put it: it goes to the audit trail and
-- the operator's screen, and is never seen again. Nothing else can recover it
-- either, because `factory.verify_live` only walks deployments that are still
-- `live`, so a withdrawn-but-still-serving site is invisible to every check in
-- the system.

alter table site_deployments
  -- What the address actually did after the withdrawal was accepted. Null
  -- means the read-back has not run or could not reach a verdict — never
  -- "assumed gone", which is the direction that would matter.
  add column if not exists withdrawal_verdict text,
  -- When that verdict was reached. A withdrawal confirmed ten minutes ago and
  -- one confirmed in March are different kinds of evidence, and only the
  -- timestamp tells them apart.
  add column if not exists withdrawal_checked_at timestamptz;

alter table site_deployments drop constraint if exists site_deployments_withdrawal_verdict_check;

alter table site_deployments
  add constraint site_deployments_withdrawal_verdict_check
  check (
    withdrawal_verdict is null
    or withdrawal_verdict in ('withdrawn', 'still_serving', 'serving_other', 'unreadable')
  );

-- A verdict with no time, or a time with no verdict, is an incoherent
-- observation: one of them claims something was established without saying
-- when, and the other claims a check happened without saying what it found.
-- Both are refused rather than tidied up later.
alter table site_deployments drop constraint if exists site_deployments_withdrawal_coherent_check;

alter table site_deployments
  add constraint site_deployments_withdrawal_coherent_check
  check ((withdrawal_verdict is null) = (withdrawal_checked_at is null));

comment on column site_deployments.withdrawal_verdict is
  'What the public address did after withdrawal: withdrawn | still_serving | serving_other | unreadable. Null means unestablished, never "gone".';
comment on column site_deployments.withdrawal_checked_at is
  'When the withdrawal read-back reached its verdict. Null exactly when the verdict is null.';

-- Answers "which withdrawn deployments are not confirmed gone" without
-- scanning history. `is distinct from` is deliberate: it admits null, because
-- a withdrawal nobody checked belongs in this set just as much as one observed
-- still serving.
--
-- CONSEQUENCE OF APPLYING: every withdrawal that predates this migration has a
-- null verdict, so all of them enter that set the moment it exists — four rows
-- as of 2026-08-04, all of them fixtures whose addresses do answer 404 today.
-- That is the honest starting state rather than a defect: nothing checked
-- them, so nothing can claim they are confirmed. It is also self-correcting,
-- because the first re-check of each resolves it to 'withdrawn'.
create index if not exists site_deployments_withdrawal_unconfirmed
  on site_deployments (space_id, superseded_at desc)
  where status = 'unpublished' and withdrawal_verdict is distinct from 'withdrawn';

insert into supabase_migrations.schema_migrations (version, name)
values ('0011', 'deployment_withdrawal_verdict')
on conflict (version) do nothing;
