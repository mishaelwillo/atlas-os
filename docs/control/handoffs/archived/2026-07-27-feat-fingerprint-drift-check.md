# Current Handoff

**Handoff ID:** `feat-fingerprint-drift-check`
**Status:** active
**Started:** 2026-07-27T18:14:13.487Z
**Updated:** 2026-07-27T18:14:13.487Z
**Actor:** Codex
**Objective:** Close the drift gap that let a service publish a stale schema version unnoticed

## Active work

- Work item: `P2C-REVENUE-001`
- Branch: `feat/fingerprint-drift-check`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `d33eea1ee940fdf9c91a5e390afc2c03de3328aa`
- Review status: pending independent review

## Task change evidence

- Added a drift check comparing each service's claimed schemaVersion against expected_migration, treating an admitted unknown as honest

## Current working tree

- ` M docs/control/CURRENT_HANDOFF.md`
- `?? docs/control/handoffs/archived/2026-07-27-feat-outreach-policy.md`

## Verification evidence

- 3 new drift tests, 241/241 control-schema tests, lint 0, uncached 8/8 builds; a mutation treating unknown as a claim failed a test; verified silent against live production

## Database actions

- No external action reported.
- Observed Supabase status: ok (live-read-only at 2026-07-27T18:13:14.737Z).

## Hosting actions

- No external action reported.
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-07-27T18:13:14.737Z).

## External side effects

- No external action reported.

## Blockers

- Not supplied.

## Next exact action

Continue revenue-pilot build-now scope, or await the hosting and evidence decisions that block the remaining phases

## Definition of done

The active task acceptance checks pass and the handoff is updated.
