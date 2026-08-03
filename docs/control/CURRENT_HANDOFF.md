# Current Handoff

**Handoff ID:** `capability-execution-mode`
**Status:** active
**Started:** 2026-08-03T20:16:56.661Z
**Updated:** 2026-08-03T20:16:56.661Z
**Actor:** Claude
**Objective:** Stop runs.execute answering deterministic capabilities with model prose

## Active work

- Work item: `P2C-REVENUE-001`
- Branch: `feat/deterministic-capability-execution`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `67d6dc1cb773015e0f89dec5b46410c51ff2031d`
- Review status: pending independent review

## Task change evidence

- Every registry entry declares execution: handler or model; runs.execute branches on it; hosting.activate and hosting.cancel gained the handler entries they never had

## Current working tree

- Clean.

## Verification evidence

- pnpm build, pnpm test (902 tests) and pnpm lint exit 0; the handler branch mutation-tested, failing 4 tests

## Database actions

- Migration 0008_run_answered_by_handler written and NOT applied; expected_migration still pins 0007_deployment_fingerprint
- Observed Supabase status: ok (live-read-only at 2026-08-03T06:21:29.385Z).

## Hosting actions

- No external action reported.
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-08-03T06:21:29.385Z).

## External side effects

- No external action reported.

## Blockers

- Until 0008 is applied a handler-executed run will fail the answered_by check constraint

## Next exact action

Apply migration 0008_run_answered_by_handler and bump expected_migration, then decide the Cloudflare Bot Fight Mode setting and wire a rollback capability

## Definition of done

A run of a deterministic capability invokes its handler and records no model cost
