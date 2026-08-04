# Current Handoff

**Handoff ID:** `revise-and-unpublish`
**Status:** active
**Started:** 2026-08-04T20:14:50.206Z
**Updated:** 2026-08-04T20:14:50.206Z
**Actor:** Claude
**Objective:** Make rollback reachable and give withdrawal a capability

## Active work

- Work item: `P2C-REVENUE-001`
- Branch: `feat/revise-and-unpublish`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `fa5ce4494c22a12a87b8578cab30fb7bdffd25ae`
- Review status: pending independent review

## Task change evidence

- factory.revise_site and factory.unpublish added; siblings republish from retained bytes rather than re-rendering; executable count 31 to 33

## Current working tree

- Clean.

## Verification evidence

- pnpm build, pnpm test (937 tests) and pnpm lint exit 0; the collateral-damage guard and the empty-revision guard each mutation-tested

## Database actions

- Migration 0010_deployment_unpublished written and NOT applied; expected_migration still pins 0009_deployment_build_html
- Observed Supabase status: ok (live-read-only at 2026-08-04T03:42:40.880Z).

## Hosting actions

- No external action reported.
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-08-04T03:42:40.880Z).

## External side effects

- No external action reported.

## Blockers

- Until 0010 is applied a withdrawal will fail the status check constraint

## Next exact action

Apply migration 0010_deployment_unpublished, then run the timed P2B acceptance through Mission Control

## Definition of done

A site can reach a second version, and a live site can be withdrawn without a direct database write
