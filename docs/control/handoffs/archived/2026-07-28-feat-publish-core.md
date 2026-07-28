# Current Handoff

**Handoff ID:** `feat-publish-core`
**Status:** active
**Started:** 2026-07-27T23:37:55.183Z
**Updated:** 2026-07-27T23:39:00.769Z
**Actor:** Codex
**Objective:** Build the routing-independent publish and rollback core for the Website Factory (P2B-FACTORY-001)

## Active work

- Work item: `P2B-FACTORY-001`
- Branch: `feat/publish-core`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `9f4138143bba2a70f6a2527111ae8c94edd78b81`
- Review status: pending independent review

## Task change evidence

- Added publish verification, deployment history with rollback planning, a review-only migration, and corrected the queue now that routing is decided

## Current working tree

- ` M docs/control/WORK_QUEUE.yaml`

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

Create the sites service and point sites.andtronai.com at it, then wire the hosting target so a queued deployment can serve

## Definition of done

The active task acceptance checks pass and the handoff is updated.
