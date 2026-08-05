# Current Handoff

**Handoff ID:** `withdrawal-verdict-persisted`
**Status:** active
**Started:** 2026-08-05T06:18:59.047Z
**Updated:** 2026-08-05T06:18:59.047Z
**Actor:** Claude
**Objective:** Pin migration 0011 and persist the withdrawal verdict

## Active work

- Work item: `P2C-REVENUE-001`
- Branch: `feat/persist-withdrawal-verdict`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `172fce4c5c6723a98a845a5bf2b46c1d2efd8462`
- Review status: pending independent review

## Task change evidence

- Pinned expected_migration and ATLAS_SCHEMA_VERSION to 0011, wrote the verdict from the unpublish dispatcher, and extended factory.verify_live to re-check unconfirmed withdrawals

## Current working tree

- Clean.

## Verification evidence

- ledger, columns, constraints and index read from the live schema; control:status reports no migration or schema-claim drift; both write statements dry-run against the real schema and rolled back; 605 API tests pass

## Database actions

- Operator applied 0011_deployment_withdrawal_verdict; Claude pinned expected_migration and set ATLAS_SCHEMA_VERSION on both services, then redeployed them
- Observed Supabase status: ok (live-read-only at 2026-08-05T06:12:01.756Z).

## Hosting actions

- No external action reported.
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-08-05T06:12:01.756Z).

## External side effects

- No external action reported.

## Blockers

- Not supplied.

## Next exact action

Exercise the three P2C cards in a signed-in browser

## Definition of done

0011 is pinned and verified, the dispatcher persists the verdict, and the sweep re-checks withdrawals not confirmed gone
