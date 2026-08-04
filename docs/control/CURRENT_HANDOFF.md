# Current Handoff

**Handoff ID:** `pin-migration-0010`
**Status:** active
**Started:** 2026-08-04T20:40:07.194Z
**Updated:** 2026-08-04T20:40:07.194Z
**Actor:** Claude
**Objective:** Pin the applied 0010 schema across the control plane

## Active work

- Work item: `P2C-REVENUE-001`
- Branch: `chore/pin-migration-0010`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `4b01fe4f93c7038385aef9854455f45aea5488f7`
- Review status: pending independent review

## Task change evidence

- Not supplied.

## Current working tree

- Clean.

## Verification evidence

- The status check now lists unpublished; the insert that would previously have violated it succeeded and was rolled back

## Database actions

- Operator applied 0010_deployment_unpublished; verified through control:status and by inserting an unpublished deployment inside a rolled-back transaction
- Observed Supabase status: ok (live-read-only at 2026-08-04T20:38:21.554Z).

## Hosting actions

- Set ATLAS_SCHEMA_VERSION=0010_deployment_unpublished on the Railway api and os services
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-08-04T20:38:21.554Z).

## External side effects

- No external action reported.

## Blockers

- Not supplied.

## Next exact action

Exercise the full factory loop against production — publish, revise, publish again, roll back, withdraw — then run the timed P2B acceptance through Mission Control

## Definition of done

Expected and observed migration identity agree, and a withdrawal can record what it is
