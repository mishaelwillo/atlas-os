# Current Handoff

**Handoff ID:** `p2c-funnel-analytics`
**Status:** active
**Started:** 2026-08-03T04:16:19.198Z
**Updated:** 2026-08-03T04:16:19.198Z
**Actor:** Claude
**Objective:** Build funnel analytics and the operator surface

## Active work

- Work item: `P2C-REVENUE-001`
- Branch: `feat/p2c-funnel-analytics`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `98d661913c869ad72281db3edb64093d018d3c6c`
- Review status: pending independent review

## Task change evidence

- analytics.funnel added and a funnel card wired into status.mission_control; executable count 28 to 29

## Current working tree

- Clean.

## Verification evidence

- pnpm build, pnpm test (839 tests) and pnpm lint exit 0; the null-rate rule mutation-tested on both the API and the card, failing 5 and 2 tests

## Database actions

- No external action reported.
- Observed Supabase status: ok (live-read-only at 2026-08-03T03:24:58.972Z).

## Hosting actions

- No external action reported.
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-08-03T03:24:58.972Z).

## External side effects

- No external action reported.

## Blockers

- The funnel is empty because lead sourcing has no directory adapter, and the Mission Control card was not exercised in a signed-in browser

## Next exact action

Decide the directory adapter for lead sourcing; the P2C build-now scope is complete and the pilot's exit criterion blocks on that integration

## Definition of done

A rate with no denominator reads as unknown rather than zero, end to end from the query to the rendered card
