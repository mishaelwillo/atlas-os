# Current Handoff

**Handoff ID:** `fix-deployment-insert-types`
**Status:** active
**Started:** 2026-08-03T06:32:58.820Z
**Updated:** 2026-08-03T06:32:58.820Z
**Actor:** Claude
**Objective:** Make the fingerprint read-back's insert executable against the real schema

## Active work

- Work item: `P2C-REVENUE-001`
- Branch: `fix/deployment-insert-parameter-types`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `5dadb1ceb977bb5deaa66f6d5c01f2d0b6a4187e`
- Review status: pending independent review

## Task change evidence

- Not supplied.

## Current working tree

- Clean.

## Verification evidence

- 42P08 reproduced against production; the corrected statement verified in a rolled-back transaction for both the live and queued branches

## Database actions

- Ran the insert twice inside begin/rollback against production to verify parameter typing; nothing was committed
- Observed Supabase status: ok (live-read-only at 2026-08-03T06:21:29.385Z).

## Hosting actions

- No external action reported.
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-08-03T06:21:29.385Z).

## External side effects

- No external action reported.

## Blockers

- One deploy approval is pending from the failed attempt and can be decided once the fix deploys

## Next exact action

Decide the pending deploy approval to record a real fingerprint, then run the timed acceptance through Mission Control

## Definition of done

A publish records public_fingerprint and fingerprint_matches without erroring
