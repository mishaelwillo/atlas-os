# Atlas Current State

## Generated observed state

The read-only collector is installed. A user-invoked `pnpm control:status`
refresh writes uncommitted `docs/control/generated/observed-state.json` and
`drift-report.md` with collection timestamps and provenance. If those files are
absent, no live refresh has been performed in the current worktree. Unknown
authority remains unknown; control artifacts never infer a successful live
state.

## Repository state

- Authoritative `main`: `0fdb2f835482e58690c73701cb8a86ebc7b80d18`.
- Active branch: `codex/p2a-memory-enrichment` (open in PR #4).
- Merged on 2026-07-26, each after explicit approval and with `Build & Test`
  green on the exact resulting `main` SHA:
  - PR #1 `codex/atlas-continuity` → `23a0b64`. Continuity control plane and P2
    monetization playbook. Independent whole-branch verdict was READY TO MERGE
    with no Critical or Important finding.
  - PR #2 `codex/allow-archived-handoff-metadata` → `9be3a76`. Boundary-gate
    fix: `control:archive-handoff` output is now approved metadata.
  - PR #3 `codex/p2a-intelligence-reconciliation` → `0fdb2f8`. P2A↔P1 memory
    contract reconciliation.
- Active work item: `P2A-MEMORY-001`.
- Active owning spec: `docs/specs/p2/intelligence-foundation.md`.
- Exactly one queue item is `in_progress`.

## Production deployment state

P1 production deployment closure is **complete**. The roadmap exit condition
(Railway API fingerprint matches the selected P1 commit and P1 routes exist) is
satisfied, and the live drift report has no blocking finding.

- Railway `os` deploys from GitHub automatically; `/build-info.json` reports the
  merged `main` SHA, schema `0001_init`, registry version 2.
- Railway `api` has **no GitHub source** — its prior deployment was a local
  upload with no commit metadata, which is why merges do not auto-deploy it. It
  is deployed from a pristine `git archive` checkout of exactly
  `main @ 0fdb2f8`, with `ATLAS_GIT_SHA`, `ATLAS_BUILD_TIME`, and
  `ATLAS_SCHEMA_VERSION` service variables carrying the fingerprint.
- Verified live: `/healthz` reports `gitSha 0fdb2f8`, `registryVersion 2`,
  schema `0001_init`. `POST /v1/memory/ingest` and
  `GET /v1/status/mission_control` return 401 auth-gated — previously 404, which
  was the recorded P0-versus-P1 route drift.
- Live drift report: Blocking — none. Sole warning is
  `supabase.live_state_unknown`.

## Remaining caveats

- **Supabase migration history does not exist.** Diagnosed 2026-07-26: the
  database is reachable and the table check passes — all 18 required tables are
  present and match `ENVIRONMENTS.yaml` exactly. The migration-history query
  fails with `42P01 relation "supabase_migrations.schema_migrations" does not
  exist`, and no `supabase_migrations` schema exists at all, so `0001_init.sql`
  was applied directly (SQL editor or `psql`) rather than through the Supabase
  CLI. The collector therefore cannot prove exact migration identity and
  correctly reports `supabase.live_state_unknown` — this is a missing ledger,
  not a connectivity or credentials problem.
  - Consequence: `expected_migration: 0001_init` can never be satisfied until a
    migration ledger is established (baseline `0001_init` as applied), and
    applying `0002` through the Supabase CLI would need that baseline first.
  - Establishing the ledger is a database write and remains approval-gated.
- The P1 brief's manual token-seeded live acceptance (seed Space + API token,
  ingest with the token, approval-gate round trip) has not been run. It requires
  an authorized Supabase write and remains approval-gated.
- Railway `api` should be connected to the GitHub repository (root directory =
  repo root, dockerfile `apps/api/Dockerfile`) so future merges auto-deploy as
  `os` does. This is a dashboard action. Until then, every `main` advance leaves
  the API fingerprint stale and the collector will report SHA drift.

## P2A progress

- Reconciliation (`docs/specs/p2/intelligence-reconciliation.md`) is merged. It
  maps every proposed P2A memory change to the P1 owner contract, classifies
  each as additive-optional or internal-only, and leaves every
  `capabilityMetadata.specification` unchanged. The ownership migration register
  is deliberately empty.
- `supabase/migrations/0002_intelligence_enrichment.sql` is staged in PR #4 and
  **has not been applied to any database**. `0001_init.sql` is unmodified, so
  the exact migration-identity anchor is intact. The file is statically reviewed
  only — no PostgreSQL instance was available to execute it.

## Next exact action

Review PR #4. If the staged schema is approved for application, bump
`expected_migration` in `docs/control/ENVIRONMENTS.yaml` to
`0002_intelligence_enrichment` in the same change, execute the migration against
a scratch database first, then implement the code side of card/node/run
enrichment behind the unchanged P1 routes.
