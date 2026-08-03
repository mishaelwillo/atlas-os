# Current Handoff

**Handoff ID:** `pin-migration-0006`
**Status:** active
**Started:** 2026-08-03T03:21:46.474Z
**Updated:** 2026-08-03T03:21:46.474Z
**Actor:** Claude
**Objective:** Pin the applied 0006 schema across the control plane

## Active work

- Work item: `P2C-REVENUE-001`
- Branch: `chore/pin-migration-0006`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `500bfc4970efa9f51d1106650de50a8444909075`
- Review status: pending independent review

## Task change evidence

- Not supplied.

## Current working tree

- Clean.

## Verification evidence

- control:status observed migration 0006_offers_and_hosting and 26 public tables including offers, deal_decisions and hosting_entitlements

## Database actions

- Operator applied 0006_offers_and_hosting; verified by reading the migration ledger and information_schema through control:status
- Observed Supabase status: ok (live-read-only at 2026-08-03T03:20:46.154Z).

## Hosting actions

- Set ATLAS_SCHEMA_VERSION=0006_offers_and_hosting on the Railway api and os services
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-08-03T03:20:46.154Z).

## External side effects

- No external action reported.

## Blockers

- Not supplied.

## Next exact action

Build funnel analytics and the operator surface, the last P2C build-now item

## Definition of done

Expected and observed migration identity agree, and neither service fingerprint claims a schema it is not running
