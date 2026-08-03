# Current Handoff

**Handoff ID:** `p2c-qualification-demo-queue`
**Status:** active
**Started:** 2026-08-03T00:30:12.997Z
**Updated:** 2026-08-03T00:30:12.997Z
**Actor:** Claude
**Objective:** Build prospect qualification and the capped demo queue

## Active work

- Work item: `P2C-REVENUE-001`
- Branch: `feat/p2c-qualification-demo-queue`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `75041bdbbe5ebc958b4640bac643fd71b7354abc`
- Review status: pending independent review

## Task change evidence

- prospecting.workspace promoted from candidate to executable; prospecting.qualify, demos.enqueue and demos.advance added; executable count 16 to 20, candidates 33 to 32

## Current working tree

- Clean.

## Verification evidence

- pnpm build, pnpm test (692 tests) and pnpm lint exit 0; suppression-from-lead-row and queue-cap guards mutation-tested

## Database actions

- Migration 0004_prospect_qualification written and NOT applied; no database has run it and expected_migration still pins 0003_site_deployments
- Observed Supabase status: ok (live-read-only at 2026-07-28T09:07:53.146Z).

## Hosting actions

- No external action reported.
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-07-28T09:07:53.146Z).

## External side effects

- No external action reported.

## Blockers

- Direct database access was denied in this session, so 0004 could not be applied or dry-run; the four new capabilities report schema_pending until it is

## Next exact action

Apply migration 0004_prospect_qualification, bump expected_migration and ATLAS_SCHEMA_VERSION, then continue the build-now scope: sequence state, offers/terms, hosting activation state and funnel analytics

## Definition of done

A prospect cannot take a demo slot without a standing, unexpired qualification, and the queue cannot exceed the pilot cap
