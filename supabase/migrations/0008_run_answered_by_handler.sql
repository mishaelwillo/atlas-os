-- ATLAS OS — 0008: runs answered by a handler (P2B-FACTORY-001)
-- Owning specification: briefs/P1-CODEX-services.md
--
-- Applied state lives in docs/control/ENVIRONMENTS.yaml (expected_migration),
-- which the drift collector compares against the live migration ledger. This
-- file records intent and coupling only: it cannot know its own history.
--
-- COUPLING: applying this requires bumping expected_migration to
-- 0008_run_answered_by_handler and updating ATLAS_SCHEMA_VERSION on both
-- Railway services. No new table, so required_tables is unchanged.
--
-- WHY: `answered_by` is the token-ladder rung — cache, playbook, nodes, model —
-- and every value describes a way of *answering*. A capability that does real
-- work in its own code answers by none of them, so runs.execute had nowhere
-- honest to record what happened and every non-approval capability was sent to
-- the model router instead. Recording a deterministic run as 'model' would put
-- a model's name against work no model did.
--
-- Widening a check constraint accepts every row that was already valid, so no
-- existing run is affected.

alter table runs drop constraint if exists runs_answered_by_check;

alter table runs
  add constraint runs_answered_by_check
  check (answered_by in ('cache', 'playbook', 'nodes', 'model', 'handler'));

comment on column runs.answered_by is
  'Token-ladder rung, or ''handler'' when the capability''s own code produced the result and no model was called.';

insert into supabase_migrations.schema_migrations (version, name)
values ('0008', 'run_answered_by_handler')
on conflict (version) do nothing;
