# Current Handoff

**Handoff ID:** `migration-banner-authority`
**Status:** active
**Started:** 2026-08-03T04:40:19.809Z
**Updated:** 2026-08-03T04:40:19.809Z
**Actor:** Claude
**Objective:** Stop migration files claiming whether they have been applied

## Active work

- Work item: `P2C-REVENUE-001`
- Branch: `fix/migration-banner-authority`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `4e3df8241270bf5a4fffcae2c3024b6588e951fc`
- Review status: pending independent review

## Task change evidence

- Added control.migration_claims_applied_state to verify-static; removed the false banner from migrations 0002 through 0006

## Current working tree

- Clean.

## Verification evidence

- pnpm build, pnpm test (845 tests) and pnpm lint exit 0; the gate mutation-tested by reintroducing a banner, which failed verify and one test; non-comment content of all five migrations hashes identically before and after

## Database actions

- No external action reported.
- Observed Supabase status: ok (live-read-only at 2026-08-03T03:24:58.972Z).

## Hosting actions

- No external action reported.
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-08-03T03:24:58.972Z).

## External side effects

- No external action reported.

## Blockers

- Not supplied.

## Next exact action

Decide the directory adapter for lead sourcing; the P2C build-now scope is complete and the pilot's exit criterion blocks on that integration

## Definition of done

A migration comment asserting applied state in either direction is a blocking control:verify finding
