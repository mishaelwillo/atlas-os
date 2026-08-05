# Current Handoff

**Handoff ID:** `withdrawal-readback`
**Status:** active
**Started:** 2026-08-05T00:35:50.647Z
**Updated:** 2026-08-05T00:35:50.647Z
**Actor:** Claude
**Objective:** Confirm a withdrawal actually stopped serving before reporting it withdrawn

## Active work

- Work item: `P2C-REVENUE-001`
- Branch: `fix/withdrawal-readback`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `c86e53d36d3fe6ffe07f2c66f791cb08b219efaa`
- Review status: pending independent review

## Task change evidence

- Added classifyWithdrawal and withdrawUntilGone, wired into the unpublish dispatcher with its verdict audited and returned

## Current working tree

- Clean.

## Verification evidence

- 597 API tests pass; treating an unreadable address as gone fails three tests; build, lint and control:verify green

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

factory.unpublish reports whether the address stopped serving, and never claims gone for an address it could not read
