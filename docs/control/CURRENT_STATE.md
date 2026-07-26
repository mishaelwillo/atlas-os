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
- Railway `api` is now connected to `mishaelwillo/atlas-os` on `main` and
  deploys from GitHub like `os`. Before 2026-07-26 it had no source at all
  (`source.repo = null`) and its deployments were local CLI uploads with no
  commit metadata, which is why merges never auto-deployed it and the P0 route
  set persisted. Manual `railway up` from a pristine `git archive` checkout is
  no longer required.
- The API fingerprint is derived from `RAILWAY_GIT_COMMIT_SHA`. The temporary
  `ATLAS_GIT_SHA` and `ATLAS_BUILD_TIME` variables used for the manual
  deployments were deleted once GitHub deploys were live: `env.ts` resolves
  `gitSha(ATLAS_GIT_SHA, RAILWAY_GIT_COMMIT_SHA)` first-match-wins, so leaving
  them set would have pinned `/healthz` to a stale SHA forever regardless of
  what actually shipped. Only `ATLAS_SCHEMA_VERSION` remains, which is not
  git-derived.
- `buildTime` now reports `unknown` because nothing passes the
  `ATLAS_BUILD_TIME` Docker build arg. The fingerprint validator explicitly
  accepts `unknown`, and drift detection keys on `gitSha`, so this is an honest
  gap rather than a failure. Optional polish: pass the build arg at build time
  or add a Railway-provided timestamp fallback in `env.ts`.
- Verified live: `/healthz` reports the current `main` SHA sourced from Railway
  Git, `registryVersion 2`, schema `0001_init`. `POST /v1/memory/ingest` and
  `GET /v1/status/mission_control` return 401 auth-gated — previously 404, which
  was the recorded P0-versus-P1 route drift.
- Live drift report at `6894fc3` (2026-07-26T21:30Z): **Blocking none, Warning
  none, Info none**, with every authority reporting `ok` — local Git, GitHub
  head and CI, Supabase tables and migration identity, Railway API, Railway OS,
  and the registry. This is the first fully clean observation recorded for this
  project.

## Remaining caveats

- Resolved 2026-07-26: the Supabase migration ledger is baselined. Originally
  no `supabase_migrations` schema existed at all — `0001_init.sql` had been
  applied directly rather than through the Supabase CLI, so exact migration
  identity was unprovable and the collector honestly reported
  `supabase.live_state_unknown`. The operator created
  `supabase_migrations.schema_migrations` (in the shape the Supabase CLI
  expects) and recorded `0001` / `init` as applied. The collector's
  migration-identity query now returns `0001_init`, matching
  `expected_migration` in `ENVIRONMENTS.yaml`.
- P1 live acceptance ran 2026-07-26 against production, token-authenticated.
  Passed: ingest admitted 2 cards scoped to the `atlas` space; identical
  re-ingest returned `admitted 0 / skipped 2`, proving the hash-dedupe
  incremental contract; unauthenticated and unknown-token calls returned 401;
  `outreach.send` and `approvals.decide` returned 403 `operator-only
  capability`; and each successful call wrote one `audit_log` row whose actor
  was the `p1-acceptance-test` token label.
  - Security invariants held: `messages` is empty, `approvals` is empty, and no
    outbound message exists without `approved_by`. The outreach attempt was
    refused at the auth layer before any approval row was created, so nothing
    was queued or sent.
  - **Not covered:** the operator half of the round trip (`outreach.send`
    creating an `approvalId`, then an operator approving and the dispatcher
    firing). A capability with empty `scopes` is operator-only
    (`apps/api/src/auth.ts`), so it requires a Supabase Auth JWT for the pinned
    operator email and cannot be driven by an API token. It must be exercised
    through the Mission Control UI.
  - Observation, not a defect: rejected 401/403 calls write no `audit_log` row.
    `SECURITY.md` requires an audit insert on every privileged call, and a
    rejected call never becomes privileged — but failed authentication
    attempts therefore leave no audit trail.
  - The `p1-acceptance-test` token should be disabled once the operator leg is
    finished.
- Resolved 2026-07-26: Railway `api` is connected to GitHub and self-deploys.
  Both services now advance with `main` automatically.

## P2A progress

- Reconciliation (`docs/specs/p2/intelligence-reconciliation.md`) is merged. It
  maps every proposed P2A memory change to the P1 owner contract, classifies
  each as additive-optional or internal-only, and leaves every
  `capabilityMetadata.specification` unchanged. The ownership migration register
  is deliberately empty.
- `supabase/migrations/0002_intelligence_enrichment.sql` is merged into `main`
  (PR #4) and **has not been applied to any database**. Merging moved the file
  into the repository and nothing else: nothing in CI, the Docker image, or the
  API boot path executes migrations, and the P1 routes were re-verified as
  unchanged afterward. `0001_init.sql` is unmodified, so the migration-identity
  anchor is intact and the ledger still reports `0001_init`.
- The `0002` file is statically reviewed only. Every referenced table exists in
  `0001_init` and no added column name collides with an existing one, but no
  PostgreSQL instance was available to execute it, so it is not
  execution-proven. Run it against a scratch database before applying.

## Next exact action

Implement the code side of Intelligence Bank enrichment (`P2A-MEMORY-001`)
behind the unchanged P1 routes, per `docs/specs/p2/intelligence-foundation.md`
and the reconciliation deltas.

Applying `0002` is a separate approval-gated step. When it is approved: execute
it against a scratch database first, then apply it and bump
`expected_migration` in `docs/control/ENVIRONMENTS.yaml` to
`0002_intelligence_enrichment` in the same change, or the collector will report
blocking Supabase migration drift. Now that the ledger exists, `supabase
migration list` and `db push` are usable for this.
