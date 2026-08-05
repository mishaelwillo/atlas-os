# Current Handoff

**Handoff ID:** `regenerate-capability-catalog`
**Status:** active
**Started:** 2026-08-05T06:24:10.327Z
**Updated:** 2026-08-05T06:24:10.327Z
**Actor:** Claude
**Objective:** Restore main to green by regenerating the committed capability catalog

## Active work

- Work item: `P2C-REVENUE-001`
- Branch: `fix/regenerate-capability-catalog`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `ff0876f2e30a63e6b5f2cafa61711cfb3e27b15a`
- Review status: pending independent review

## Task change evidence

- Regenerated docs/control/generated/capability-catalog.md after factory.verify_live's description changed

## Current working tree

- Clean.

## Verification evidence

- the catalog gate failed on PR 71 and on main; regenerated locally and the diff is the single description line

## Database actions

- No external action reported.
- Observed Supabase status: ok (live-read-only at 2026-08-05T06:12:01.756Z).

## Hosting actions

- No external action reported.
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-08-05T06:12:01.756Z).

## External side effects

- No external action reported.

## Blockers

- PR 71 was merged while its CI was red because the merge was chained with ';' after gh run watch, and the main run reported green was a stale one

## Next exact action

Exercise the three P2C cards in a signed-in browser

## Definition of done

The generated catalog matches the registry and CI is green on main
