# Current Handoff

**Handoff ID:** `factory-rollback`
**Status:** active
**Started:** 2026-08-04T03:30:41.295Z
**Updated:** 2026-08-04T03:30:41.295Z
**Actor:** Claude
**Objective:** Give rollback a capability so takedowns stop needing direct database writes

## Active work

- Work item: `P2C-REVENUE-001`
- Branch: `feat/factory-rollback`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `bd8427803ca4e47db5500e3c058cef8a1630d252`
- Review status: pending independent review

## Task change evidence

- factory.rollback added, approval-gated; site_deployments retains build_html; executable count 30 to 31

## Current working tree

- Clean.

## Verification evidence

- pnpm build, pnpm test (917 tests) and pnpm lint exit 0; the stored-bytes requirement mutation-tested, failing 4 tests

## Database actions

- Migration 0009_deployment_build_html written and NOT applied; expected_migration still pins 0008_run_answered_by_handler
- Observed Supabase status: ok (live-read-only at 2026-08-04T01:55:43.749Z).

## Hosting actions

- No external action reported.
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-08-04T01:55:43.749Z).

## External side effects

- No external action reported.

## Blockers

- Until 0009 is applied, publishing cannot retain bytes and every rollback will refuse with no_stored_build

## Next exact action

Apply migration 0009_deployment_build_html and bump expected_migration, then decide the Cloudflare Bot Fight Mode setting

## Definition of done

A rollback restores the exact bytes a previously-serving deployment published, or refuses
