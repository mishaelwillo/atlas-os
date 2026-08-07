# Current Handoff

**Handoff ID:** `pin-0012`
**Status:** active
**Started:** 2026-08-07T20:46:58.804Z
**Updated:** 2026-08-07T20:46:58.804Z
**Actor:** Claude
**Objective:** Pin the applied 0012 migration and correct the ledger name it recorded

## Active work

- Work item: `P2C-REVENUE-001`
- Branch: `fix/pin-0012-and-ledger-name`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `7b541242a5a29ad601a337b481827d3ca73d716d`
- Review status: pending independent review

## Task change evidence

- Pinned expected_migration and required_tables, set ATLAS_SCHEMA_VERSION on both services, corrected the 0012 ledger name

## Current working tree

- Clean.

## Verification evidence

- Ledger, tables and constraints read from production; control:status exits 0 with no findings

## Database actions

- Updated one supabase_migrations row from the prefixed name to the bare one, inside a transaction that verified the composed identity first
- Observed Supabase status: ok (live-read-only at 2026-08-07T20:46:19.807Z).

## Hosting actions

- No external action reported.
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-08-07T20:46:19.807Z).

## External side effects

- No external action reported.

## Blockers

- Not supplied.

## Next exact action

Build the Mission Control surface for the cost and outcome record, which has capabilities but no operator screen

## Definition of done

control:status reports no blocking or warning findings with 0012 pinned on both services
