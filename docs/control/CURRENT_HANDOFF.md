# Current Handoff

**Handoff ID:** `read-back-budget`
**Status:** active
**Started:** 2026-08-05T00:13:58.420Z
**Updated:** 2026-08-05T00:13:58.420Z
**Actor:** Claude
**Objective:** Widen the post-publish read-back budget so a first publish does not record a false mismatch

## Active work

- Work item: `P2C-REVENUE-001`
- Branch: `fix/read-back-budget`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `449695c33f0a83871d6fec248da010e7ad735708`
- Review status: pending independent review

## Task change evidence

- Read-back gaps now double from 2s capped at 16s across seven reads; the budget is asserted by a test

## Current working tree

- Clean.

## Verification evidence

- 583 API tests pass; dropping one attempt fails the budget test; build, lint and control:verify green

## Database actions

- No external action reported.
- Observed Supabase status: ok (live-read-only at 2026-08-04T22:57:39.336Z).

## Hosting actions

- No external action reported.
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-08-04T22:57:39.336Z).

## External side effects

- No external action reported.

## Blockers

- Not supplied.

## Next exact action

Exercise the three P2C cards in a signed-in browser

## Definition of done

A first publish to a fresh address records a match rather than a mismatch that the sweep later corrects
