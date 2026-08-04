# Current Handoff

**Handoff ID:** `pin-migration-0009`
**Status:** active
**Started:** 2026-08-04T03:44:09.839Z
**Updated:** 2026-08-04T03:44:09.839Z
**Actor:** Claude
**Objective:** Pin the applied 0009 schema across the control plane

## Active work

- Work item: `P2C-REVENUE-001`
- Branch: `chore/pin-migration-0009`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `3991cdd74bf5827b91ddb27f0b7b03dd3d98471a`
- Review status: pending independent review

## Task change evidence

- Not supplied.

## Current working tree

- Clean.

## Verification evidence

- build_html is text and nullable; the deploy insert returned retained true; all three pre-existing deployment rows carry no bytes, as expected

## Database actions

- Operator applied 0009_deployment_build_html; verified through control:status and by running the deploy insert inside a rolled-back transaction
- Observed Supabase status: ok (live-read-only at 2026-08-04T03:42:40.880Z).

## Hosting actions

- Set ATLAS_SCHEMA_VERSION=0009_deployment_build_html on the Railway api and os services
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-08-04T03:42:40.880Z).

## External side effects

- No external action reported.

## Blockers

- Not supplied.

## Next exact action

Decide the Cloudflare Bot Fight Mode setting for sites.andtronai.com, then run the timed P2B acceptance through Mission Control

## Definition of done

Expected and observed migration identity agree, and a publish retains the bytes a rollback would restore
