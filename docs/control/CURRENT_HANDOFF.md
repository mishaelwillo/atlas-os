# Current Handoff

**Handoff ID:** `feat-publish-core`
**Status:** active
**Started:** 2026-07-27T23:37:55.183Z
**Updated:** 2026-07-27T23:37:55.183Z
**Actor:** Codex
**Objective:** Build the routing-independent publish and rollback core for the Website Factory (P2B-FACTORY-001)

## Active work

- Work item: `P2C-REVENUE-001`
- Branch: `feat/publish-core`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `0029e8dc482989de1355a0173001646d459262e8`
- Review status: pending independent review

## Task change evidence

- Added publish verification, deployment history with rollback planning, and a review-only migration for site_deployments

## Current working tree

- ` M docs/control/CURRENT_HANDOFF.md`
- `?? docs/control/handoffs/archived/2026-07-27-p2c-revenue-pilot-continued.md`

## Verification evidence

- 13 publish unit tests plus 10 through approval, 171/171 API tests, lint 0, uncached 8/8 builds; mutations trusting the approved hash and allowing rollback to a never-live build failed 3 tests each

## Database actions

- None. 0003_site_deployments.sql is written for review and has NOT been executed
- Observed Supabase status: ok (live-read-only at 2026-07-27T20:44:46.799Z).

## Hosting actions

- No external action reported.
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-07-27T20:44:46.799Z).

## External side effects

- No external action reported.

## Blockers

- No hosting target exists, so deployments are recorded as queued and nothing serves publicly

## Next exact action

Decide site routing, then wire a hosting target so a queued deployment can go live

## Definition of done

The active task acceptance checks pass and the handoff is updated.
