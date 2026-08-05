# Current Handoff

**Handoff ID:** `browser-run-findings`
**Status:** active
**Started:** 2026-08-05T19:10:10.836Z
**Updated:** 2026-08-05T19:10:10.836Z
**Actor:** Claude
**Objective:** Fix what the browser run of the P2C cards found

## Active work

- Work item: `P2C-REVENUE-001`
- Branch: `fix/browser-run-findings`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `21697b26e4ab7c3289ca06766a908e6506b11023`
- Review status: pending independent review

## Task change evidence

- Added permittedDealMoves and published it per lead; added an in-flight ref lock to all three P2C cards

## Current working tree

- Clean.

## Verification evidence

- 618 API and 150 OS tests pass; replacing the derivation with a fixed list fails six tests and removing the lock fails one; browser run recorded two offers 473ms apart before the fix

## Database actions

- No external action reported.
- Observed Supabase status: ok (live-read-only at 2026-08-05T06:12:01.756Z).

## Hosting actions

- No external action reported.
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-08-05T06:12:01.756Z).

## External side effects

- No external action reported.

## Blockers

- Not supplied.

## Next exact action

Re-verify the deal control and the publish lock in the browser against the deployed build

## Definition of done

Deal moves are derived like demo and touch moves, and one click cannot create two offer versions
