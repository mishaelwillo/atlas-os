-- ATLAS OS — 0007: observed public fingerprint (P2B-FACTORY-001)
-- Owning specification: docs/specs/p2/website-factory.md
--
-- Applied state lives in docs/control/ENVIRONMENTS.yaml (expected_migration),
-- which the drift collector compares against the live migration ledger. This
-- file records intent and coupling only: it cannot know its own history.
--
-- COUPLING: applying this requires bumping expected_migration to
-- 0007_deployment_fingerprint and updating ATLAS_SCHEMA_VERSION on both Railway
-- services — or the fingerprints keep claiming 0006 and `pnpm control:status`
-- reports blocking drift. No new table, so required_tables is unchanged.
--
-- Strictly additive: three nullable columns on site_deployments. No existing
-- column, row or policy is altered, and every historical row keeps a null
-- observation, which is the truth — nothing read those addresses back.
--
-- WHY: `build_hash` is what Atlas intended to publish. Nothing recorded what
-- the public actually receives, so the acceptance "public fingerprint equals
-- approved build" was asserted rather than measured. The 2026-08-03 benchmark
-- found the gap: the provider origin served the approved bytes exactly while
-- the public address served 938 more, because the zone injects a bot-detection
-- script. The row said `live` and claimed a fingerprint it had never checked.

alter table site_deployments
  -- sha256 of what the public address actually served. Null means the read-back
  -- has not run or could not read it — never "assumed fine".
  add column if not exists public_fingerprint text,
  -- When the read-back ran. Null with a non-null fingerprint is impossible.
  add column if not exists fingerprint_checked_at timestamptz,
  -- Whether public_fingerprint equals build_hash. Null is "not established",
  -- which is a different thing from false.
  add column if not exists fingerprint_matches boolean;

comment on column site_deployments.public_fingerprint is
  'sha256 of what the public address served, measured after publishing.';
comment on column site_deployments.fingerprint_matches is
  'True only when the public address served exactly the approved build. Null means unestablished, not fine.';

-- Answers "which live deployments are not serving what we approved" without
-- scanning history.
create index if not exists site_deployments_fingerprint_mismatch
  on site_deployments (space_id, fingerprint_checked_at desc)
  where fingerprint_matches is distinct from true;

insert into supabase_migrations.schema_migrations (version, name)
values ('0007', 'deployment_fingerprint')
on conflict (version) do nothing;
