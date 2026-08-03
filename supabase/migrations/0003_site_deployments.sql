-- ATLAS OS — 0003: site deployment history (P2B-FACTORY-001)
-- Owning specification: docs/specs/p2/website-factory.md
--
-- Applied state lives in docs/control/ENVIRONMENTS.yaml (expected_migration),
-- which the drift collector compares against the live migration ledger. This
-- file records intent and coupling only: it cannot know its own history, and
-- the banner that used to claim otherwise went stale the moment it ran.
--
-- COUPLING: docs/control/ENVIRONMENTS.yaml pins expected_migration. Applying
-- this requires bumping it to 0003_site_deployments in the same approved
-- change, or the next `pnpm control:status` reports blocking Supabase drift.
--
-- Strictly additive: a new table plus indexes. No existing table, column, row
-- or policy is altered. The `sites` table keeps `deploy_url` and `status` as
-- the current-state summary; this records the history those cannot express.
--
-- Rollback is the reason this table exists. The specification requires that a
-- rollback "proves previous fingerprint healthy", which is impossible without
-- retaining which build was live before and whether it was serving.

create table if not exists site_deployments (
  deployment_id  uuid primary key default gen_random_uuid(),
  space_id       uuid not null references spaces on delete cascade,
  site_id        uuid not null references sites on delete cascade,
  -- Monotonic per site. A rollback creates a NEW version that re-promotes an
  -- older build, rather than mutating history.
  version        integer not null,
  environment    text not null default 'production'
                 check (environment in ('preview', 'production')),
  -- Public address once live; null while queued.
  domain         text,
  -- sha256 of the rendered build. Publishing promotes exactly this hash, so a
  -- descriptor edited after approval cannot reach production unnoticed.
  build_hash     text not null,
  -- Commit the renderer itself was built from, so a byte change caused by the
  -- renderer rather than the descriptor stays attributable.
  renderer_sha   text,
  status         text not null default 'queued'
                 check (status in ('queued', 'live', 'superseded', 'rolled_back', 'failed')),
  -- Operator who approved the publish; approvals remain the authority.
  approved_by    text,
  -- Set when this deployment re-promotes an earlier one.
  rolled_back_to uuid references site_deployments on delete set null,
  created_at     timestamptz not null default now(),
  went_live_at   timestamptz,
  superseded_at  timestamptz,
  unique (site_id, version)
);

comment on column site_deployments.build_hash is
  'sha256 of the rendered HTML. The public fingerprint must equal the approved build.';
comment on column site_deployments.rolled_back_to is
  'The deployment whose build this one re-promotes, when rolling back.';

-- One live production deployment per site. This is the invariant that makes
-- "what is currently published" answerable without scanning history.
create unique index if not exists site_deployments_one_live
  on site_deployments (site_id)
  where status = 'live' and environment = 'production';

create index if not exists site_deployments_site_version
  on site_deployments (site_id, version desc);

create index if not exists site_deployments_space
  on site_deployments (space_id, created_at desc);

alter table site_deployments enable row level security;

-- Mirrors the space-scoped policy pattern established in 0001 for tenant data.
create policy deployments_operator on site_deployments
  for all using (is_operator()) with check (is_operator());
create policy deployments_space on site_deployments
  for select using (space_id = current_space());
