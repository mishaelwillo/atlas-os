# Current Handoff

**Handoff ID:** `pin-migration-0004`
**Status:** active
**Started:** 2026-08-03T00:59:18.110Z
**Updated:** 2026-08-03T00:59:18.110Z
**Actor:** Claude
**Objective:** Pin the applied 0004 schema across the control plane

## Active work

- Work item: `P2C-REVENUE-001`
- Branch: `chore/pin-migration-0004`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `30f742f832c3a7cbe2a30da2e68922910ba386f9`
- Review status: pending independent review

## Task change evidence

- Not supplied.

## Current working tree

- Clean.

## Verification evidence

- control:status observed migration 0004_prospect_qualification and both new tables; expected_migration and both service variables now match

## Database actions

- Operator applied 0004_prospect_qualification; verified by reading the migration ledger and information_schema through control:status
- Observed Supabase status: ok (live-read-only at 2026-08-03T00:57:04.398Z).

## Hosting actions

- Set ATLAS_SCHEMA_VERSION=0004_prospect_qualification on the Railway api and os services
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-08-03T00:57:04.398Z).

## External side effects

- No external action reported.

## Blockers

- Both applied migrations still carry a false REVIEW ONLY banner and nothing cross-checks it against expected_migration

## Next exact action

Continue the P2C build-now scope: sequence state, offers/terms, hosting activation state and funnel analytics

## Definition of done

Expected and observed migration identity agree, and neither service fingerprint claims a schema it is not running
