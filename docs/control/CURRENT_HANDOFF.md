# Current Handoff

**Handoff ID:** `atlas-continuity-implementation-20260724-02`
**Status:** active
**Updated:** 2026-07-24
**Actor:** Codex
**Objective:** Continue the approved Atlas continuity control-plane implementation without mutating external systems.

## Active work

- Work item: `P2A-CONTROL-001`
- Branch: `codex/atlas-continuity`
- Specification: `CONTINUITY_DESIGN.md`
- Task state: Task 4 implemented and locally verified; pending independent review
- Task 4 base commit: `780a752f5940e66bf78fd7649cb6fc04d66a8941`
- Task 4 implementation boundary: the feature commit containing this handoff
- Task 3 base commit: `0c65770ee50a52397cbbffe34e5c99fad9eff291`
- Task 3 implementation head: `2c97df9950436210b372c2cee1d8964f725bcb07`
- Task 3 cache-safe fix: `810c05fe7a4920a2c16fc9dcfcc9fcdb51ff519f`
- Task 3 reviewed-code candidate boundary: `d997d279225c345b5f9c203f760a26ba23aa2553`
- Boundary note: the commit after `d997d279225c345b5f9c203f760a26ba23aa2553` is metadata-only and records these immutable code boundaries; it does not change executable code, tests, or build configuration.
- Review status: Task 3 approved; Task 4 pending independent review

## Files changed

- API build identity loading, `/healthz` response, Docker build arguments, and tests.
- OS build metadata generator, build integration, generated-asset tests, and API status consumer.
- Shared health response contract and generated build metadata ignore rule.
- Turbo OS build environment/cache inputs and repeatable build-fingerprint verification.
- Consistent API and OS fingerprint normalization and validation.
- Read-only observed-state collection for local Git, GitHub, Supabase, Railway
  API, Railway OS, and the generated route registry.
- Blocking drift rules, freshness warnings, deterministic generated evidence,
  and secret-safe unavailable-authority handling.
- This active handoff.

## Verification evidence

- RED: API tests observed the legacy `{ ok, version }` health response and missing unknown fallbacks.
- RED: OS generator tests observed the absent `scripts/write-build-info.cjs`.
- GREEN: `pnpm --filter @atlas/api test` passed 25 tests.
- GREEN: `pnpm --filter @atlas/os test` passed 4 tests.
- GREEN: `pnpm --filter @atlas/os build` produced `public/build-info.json` and copied it to `dist/build-info.json`.
- GREEN: `pnpm test`, `pnpm build`, `pnpm control:verify`, and `git diff --check` passed.
- Local OS build evidence correctly reported `gitSha: "unknown"` because no build commit environment variable was supplied; this is not evidence of any live deployment.
- Review-fix RED: malformed/untrimmed API and OS fields were emitted unchanged.
- Review-fix RED: changing `ATLAS_GIT_SHA` did not change the Turbo `@atlas/os#build` dry-run hash.
- Review-fix GREEN: API and OS normalization suites and the dynamic Turbo hash test pass.
- Repeatable check: `pnpm --filter @atlas/os verify:build-info` proves the hash changes without hardcoding it and verifies `dist/build-info.json` contains supplied safe values.
- R2 RED: Turbo resolved the package-specific OS build with no `^build` dependency because the override replaced the generic build definition.
- R2 GREEN: Turbo resolves `dependsOn: ["^build"]` and cacheable outputs `build/**` plus `dist/**`; the dynamic hash and forced fingerprint checks still pass.
- Task 4 RED: the focused suite failed because
  `collect-observed-state.js` did not exist; the prior 19 schema tests passed.
- Task 4 GREEN: 6 new collector/drift tests and all 19 existing schema tests
  pass.
- Task 4 GREEN: the control-schema TypeScript build, static control
  verification, and diff whitespace checks pass.
- Task 4 safety evidence: all tests inject CLI, HTTP, and database probes; the
  database adapter permits only the approved `information_schema.tables`
  query; missing credentials and probe failures remain explicit unknown
  observations; error evidence redacts secret-like values.
- Task 4 output evidence: deterministic temporary-fixture generation writes
  two-space JSON and a sorted Markdown drift report with timestamps and
  provenance. No live refresh was performed by this task.

## Verified baseline

- GitHub repository: `mishaelwillo/atlas-os`.
- Remote `main`: `6b70726b1e`.
- Supabase has all 18 expected tables from `0001_init`.
- Railway OS is online.
- Railway API is still serving P0 routes.
- P1 code is complete, but P1 production API deployment closure remains incomplete.

## Constraints

- Never store secrets in continuity artifacts.
- Git, GitHub Actions, Supabase, and Railway remain separate authorities for their fact types.
- Do not deploy, migrate, or mutate remote systems during continuity-control documentation work.

## External writes

None.

## Assumptions and decisions

- A literal or empty `ATLAS_GIT_SHA` fallback does not mask a known `RAILWAY_GIT_COMMIT_SHA`.
- API build time remains `unknown` unless the deploy build supplies it.
- OS build time is the generator's ISO timestamp unless `ATLAS_BUILD_TIME` is supplied.
- Generated `apps/os/public/build-info.json` is ignored so a local artifact cannot be mistaken for deployed state.
- Turbo strict environment mode passes the four fingerprint variables only to `@atlas/os#build`; the task explicitly preserves `^build`, `dist/**`, and `build/**`, and the fingerprint inputs participate in its cache hash.
- Fingerprint strings are trimmed; commit SHAs must be 7–64 hexadecimal characters; timestamps are canonical ISO UTC values; schema versions must be safe tokens.
- Generated observed-state files are runtime evidence and remain uncommitted;
  `docs/control/generated/.gitkeep` preserves their output directory.
- Live status refresh is user-invoked because it reads network authorities.

## Blockers

Production P1 deployment closure remains blocked by the Railway API serving the P0 route set.
Task 5 is gated on independent approval of Task 4.

## Next exact action

Independently review Task 4 from base
`780a752f5940e66bf78fd7649cb6fc04d66a8941` through the feature commit
containing this handoff. If approved, begin Task 5 by writing failing temporary
fixture tests for handoff creation and collision-safe archival.

## Definition of done

- Task 3 API and OS fingerprint tests, full repository tests, builds, and static control verification pass.
- `WORK_QUEUE.yaml` contains exactly one `in_progress` item: `P2A-CONTROL-001`.
- API `/healthz` and OS `/build-info.json` expose safe service, application version, commit, build-time, schema, and registry fields.
- Missing commit identity is reported as `unknown`; no live deployment match is claimed.
- Turbo passes fingerprint inputs to the OS build and changes its cache hash when they change.
- The OS Turbo override explicitly preserves dependency builds and cacheable outputs.
- Public fingerprint values are normalized and invalid values become `unknown`.
- The handoff retains the active work-item identity and records Task 4 as pending
  independent review.
- Authority failures cannot prevent an observed-state report, cannot invent live
  truth, and cannot expose a database URL or secret-like error value.
- A known API SHA mismatch, a `404` P1 route, missing required tables, missing
  phase acceptance evidence, and static verification failures are blocking.
- Unknown authority state and stale handoff/snapshot state are warnings.
- Generated output is deterministic apart from the explicit collection time and
  carries source provenance.
