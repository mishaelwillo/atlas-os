# Atlas Current State

## Generated observed state

The read-only collector is installed. A user-invoked `pnpm control:status`
refresh writes uncommitted `docs/control/generated/observed-state.json` and
`drift-report.md` with collection timestamps and provenance. If those files are
absent, no live refresh has been performed in the current worktree. Unknown
authority remains unknown; control artifacts never infer a successful live
state.

## Repository state

- Active branch: `main`.
- Authoritative `main`:
  `23a0b6426d7831f3eeeeb029c8feba08d048c4dc` (merge of PR #1).
- Pull request #1 (`codex/atlas-continuity`, head
  `79f50c549b6771ecf3c079cd9f669f4f1c3c4be2`): merged on 2026-07-26 after
  explicit approval; final independent whole-branch verdict was READY TO MERGE
  with no Critical or Important finding.
- GitHub CI `Build & Test` succeeded on the exact merged `main` SHA
  `23a0b64` (run 30213365765, 40 seconds).
- Active work item: `P2A-MEMORY-001`.
- Active owning spec: `docs/specs/p2/intelligence-foundation.md`.
- Exactly one queue item is `in_progress`.

## Production deployment state

- Railway `os` service auto-deployed from GitHub on the merge;
  `/build-info.json` reports `gitSha 23a0b64`, schema `0001_init`,
  registry version 2.
- Railway `api` service had no GitHub source (its prior deployment was a local
  upload with no commit metadata), which is why the merge did not auto-deploy
  it. It was redeployed on 2026-07-26 from a pristine `git archive` checkout of
  exactly `main @ 23a0b64`; `ATLAS_GIT_SHA`, `ATLAS_BUILD_TIME`, and
  `ATLAS_SCHEMA_VERSION` service variables carry the fingerprint.
- Post-deploy verification: `/healthz` reports `gitSha 23a0b64`,
  `registryVersion 2`, schema `0001_init`; `POST /v1/memory/ingest` and
  `GET /v1/status/mission_control` return 401 auth-gated (previously 404).
- Live drift report: Blocking — none. The only warning is
  `supabase.live_state_unknown`.
- The roadmap's P1 deployment-closure exit (Railway API fingerprint matches the
  selected P1 commit and P1 routes exist) is satisfied.

## Remaining caveats

- Supabase live table/migration-history observation remains unknown: the
  read-only query fails from the local network even with injected credentials.
  Historical verification (2026-07-24) showed all 18 tables from `0001_init`.
- The P1 brief's manual token-seeded live acceptance (seed Space + API token,
  ingest with token, approval-gate round trip) has not been run; it requires an
  authorized Supabase write and remains approval-gated.
- The Railway `api` service should be connected to the GitHub repo
  (root directory = repo root, dockerfile `apps/api/Dockerfile`) so future
  merges auto-deploy like `os`; this requires a dashboard action.

## Next exact action

Implement `P2A-MEMORY-001` per `docs/specs/p2/intelligence-foundation.md` on a
new feature branch cut from `main @ 23a0b64`. Production release evidence for
this closure is recorded in the current handoff.
