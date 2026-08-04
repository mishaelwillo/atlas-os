# Current Handoff

**Handoff ID:** `pin-migration-0008`
**Status:** active
**Started:** 2026-08-04T01:51:49.976Z
**Updated:** 2026-08-04T01:51:49.976Z
**Actor:** Claude
**Objective:** Pin the applied 0008 schema across the control plane

## Active work

- Work item: `P2C-REVENUE-001`
- Branch: `chore/pin-migration-0008`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `e671a72a1479334c78ce362437a298f543bb2672`
- Review status: pending independent review

## Task change evidence

- Not supplied.

## Current working tree

- Clean.

## Verification evidence

- Constraint definition now lists handler; the insert that would previously have violated it succeeded and was rolled back

## Database actions

- Operator applied 0008_run_answered_by_handler; verified through control:status and by inserting a handler-answered run inside a rolled-back transaction
- Observed Supabase status: ok (live-read-only at 2026-08-04T01:50:08.819Z).

## Hosting actions

- Set ATLAS_SCHEMA_VERSION=0008_run_answered_by_handler on the Railway api and os services
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-08-04T01:50:08.819Z).

## External side effects

- No external action reported.

## Blockers

- Not supplied.

## Next exact action

Decide the Cloudflare Bot Fight Mode setting for sites.andtronai.com and wire a rollback capability so takedowns stop needing direct database writes

## Definition of done

Expected and observed migration identity agree, and a handler-executed run can record what it is
