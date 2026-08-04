-- ATLAS OS — 0010: unpublished deployments (P2B-FACTORY-001)
-- Owning specification: docs/specs/p2/website-factory.md
--
-- Applied state lives in docs/control/ENVIRONMENTS.yaml (expected_migration),
-- which the drift collector compares against the live migration ledger. This
-- file records intent and coupling only: it cannot know its own history.
--
-- COUPLING: applying this requires bumping expected_migration to
-- 0010_deployment_unpublished and updating ATLAS_SCHEMA_VERSION on both Railway
-- services. No new table, so required_tables is unchanged.
--
-- WHY: taking a site down had no state of its own. `superseded` means another
-- version replaced this one and `rolled_back` means an earlier build was
-- restored; neither is true of a site that was deliberately withdrawn. Both
-- takedowns so far were recorded as `rolled_back` by hand, which reads as a
-- restore that never happened.
--
-- Widening a check constraint accepts every row that was already valid, so no
-- existing deployment is affected.

alter table site_deployments drop constraint if exists site_deployments_status_check;

alter table site_deployments
  add constraint site_deployments_status_check
  check (status in ('queued', 'live', 'superseded', 'rolled_back', 'failed', 'unpublished'));

comment on column site_deployments.status is
  'queued | live | superseded (replaced by a newer version) | rolled_back (an earlier build was restored over it) | unpublished (deliberately withdrawn) | failed.';

insert into supabase_migrations.schema_migrations (version, name)
values ('0010', 'deployment_unpublished')
on conflict (version) do nothing;
