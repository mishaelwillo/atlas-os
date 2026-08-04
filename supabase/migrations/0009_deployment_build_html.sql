-- ATLAS OS — 0009: retain the published bytes (P2B-FACTORY-001)
-- Owning specification: docs/specs/p2/website-factory.md
--
-- Applied state lives in docs/control/ENVIRONMENTS.yaml (expected_migration),
-- which the drift collector compares against the live migration ledger. This
-- file records intent and coupling only: it cannot know its own history.
--
-- COUPLING: applying this requires bumping expected_migration to
-- 0009_deployment_build_html and updating ATLAS_SCHEMA_VERSION on both Railway
-- services. No new table, so required_tables is unchanged.
--
-- Strictly additive: one nullable column. Every historical row keeps a null,
-- which is the truth — those bytes were never retained.
--
-- WHY: the specification requires that a rollback "proves previous fingerprint
-- healthy", and a deployment recorded only the sha256 of what it published.
-- A hash cannot be republished. Re-rendering the descriptor does not recover
-- the old build either: the descriptor is the thing that changed, which is
-- usually why someone is rolling back at all. So the bytes are kept with the
-- deployment that served them.

alter table site_deployments
  add column if not exists build_html text;

comment on column site_deployments.build_html is
  'Exact bytes this deployment published, so a rollback can restore them. Null on rows predating this column: those bytes were never retained.';

insert into supabase_migrations.schema_migrations (version, name)
values ('0009', 'deployment_build_html')
on conflict (version) do nothing;
