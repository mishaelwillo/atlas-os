-- ATLAS OS — 0002: Intelligence Bank enrichment (P2A-MEMORY-001)
-- Owning specification: docs/specs/p2/intelligence-foundation.md
-- Reconciliation:       docs/specs/p2/intelligence-reconciliation.md
--
-- REVIEW ONLY — NOT APPLIED. No production database has run this file.
-- 0001_init.sql is unmodified; this migration is strictly additive so the exact
-- migration identity of 0001_init remains the control plane's schema anchor.
--
-- COUPLING: docs/control/ENVIRONMENTS.yaml pins expected_migration: 0001_init,
-- and the drift collector compares the latest applied migration against it.
-- Applying this file therefore requires bumping expected_migration to
-- 0002_intelligence_enrichment in the same approved change, or the next
-- `pnpm control:status` will report blocking Supabase migration drift.
--
-- Every column below is nullable or defaulted, so existing rows stay valid and
-- every P1 route keeps its current behaviour without code changes. No column is
-- dropped, renamed, retyped, or newly constrained NOT NULL. RLS is untouched:
-- the space-scoped policies in 0001 already cover these tables, and adding
-- columns does not widen any policy.

-- ---------- retention vocabulary ----------
-- Shared by cards and nodes so retention/deletion policy has one source of truth.
-- 'standard'  — default operational retention
-- 'sensitive' — shorter retention, restricted export
-- 'ephemeral' — deleted on the next retention sweep
-- 'legal-hold'— exempt from sweeps until released
do $$
begin
  if not exists (select 1 from pg_type where typname = 'retention_class') then
    create type retention_class as enum ('standard','sensitive','ephemeral','legal-hold');
  end if;
end $$;

-- ---------- L1 cards ----------
-- source/source_type already exist in 0001; these add locale, region scope,
-- retention, and cross-surface correlation.
alter table memory_cards
  add column if not exists locale          text,
  add column if not exists region          text,
  add column if not exists retention       retention_class not null default 'standard',
  add column if not exists correlation_id  uuid,
  add column if not exists quarantined_at  timestamptz,
  add column if not exists quarantine_reason text;

comment on column memory_cards.region is
  'Resolved region pack id (e.g. global, north-america, caribbean). Null means unresolved, not global.';
comment on column memory_cards.quarantined_at is
  'Set when ingest admits a malformed or source-free card for review instead of dropping it.';

create index if not exists memory_cards_correlation on memory_cards (correlation_id)
  where correlation_id is not null;
create index if not exists memory_cards_quarantined on memory_cards (quarantined_at)
  where quarantined_at is not null;

-- ---------- L2 nodes ----------
-- truth_status already carries verified/probable/quarantined in 0001, so the
-- P2A truth vocabulary needs no change. Region scope is the new axis: a
-- regional claim must never silently overwrite a global one.
alter table memory_nodes
  add column if not exists region         text,
  add column if not exists region_scope   text not null default 'global'
    check (region_scope in ('global','regional')),
  add column if not exists retention      retention_class not null default 'standard',
  add column if not exists superseded_by  uuid references memory_nodes on delete set null,
  add column if not exists adjudicated_by uuid,
  add column if not exists adjudicated_at timestamptz;

comment on column memory_nodes.region_scope is
  'Regional nodes require scoped provenance and conflict review before they can supersede a global node.';
comment on column memory_nodes.superseded_by is
  'Set on adjudication; preserves the prior node rather than mutating it.';

create index if not exists memory_nodes_region on memory_nodes (region, region_scope);

-- ---------- runs ----------
-- Correlation and digests only. Prompt and tool payloads are hashed, never
-- stored raw, per the spec's security section.
alter table runs
  add column if not exists correlation_id     uuid,
  add column if not exists capability_version integer,
  add column if not exists prompt_digest      text,
  add column if not exists tool_digest        text,
  add column if not exists outcome            text
    check (outcome is null or outcome in ('delivered','rejected','abandoned','superseded'));

comment on column runs.prompt_digest is
  'sha256 of the resolved prompt. Raw prompt text is deliberately not stored.';

create index if not exists runs_correlation on runs (correlation_id)
  where correlation_id is not null;

-- ---------- run logs ----------
alter table run_logs
  add column if not exists correlation_id uuid,
  add column if not exists tool_name      text;

create index if not exists run_logs_correlation on run_logs (correlation_id)
  where correlation_id is not null;

-- ---------- bench results ----------
alter table bench_results
  add column if not exists capability_version integer,
  add column if not exists prompt_digest      text;
