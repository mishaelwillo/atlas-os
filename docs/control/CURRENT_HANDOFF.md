# Current Handoff

**Handoff ID:** `publish-fingerprint-readback`
**Status:** active
**Started:** 2026-08-03T05:57:40.730Z
**Updated:** 2026-08-03T05:57:40.730Z
**Actor:** Claude
**Objective:** Measure the published fingerprint instead of asserting it

## Active work

- Work item: `P2C-REVENUE-001`
- Branch: `feat/publish-fingerprint-readback`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `a13cbc0090547bc3ae2713a4cbe6d9f771880599`
- Review status: pending independent review

## Task change evidence

- site_deployments gains public_fingerprint, fingerprint_checked_at and fingerprint_matches; PipelineDeps gains an injected readPublic

## Current working tree

- Clean.

## Verification evidence

- pnpm build, pnpm test (858 tests) and pnpm lint exit 0; the unreadable guard mutation-tested, failing 7 tests

## Database actions

- Migration 0007_deployment_fingerprint written and NOT applied; expected_migration still pins 0006_offers_and_hosting
- Observed Supabase status: ok (live-read-only at 2026-08-03T03:24:58.972Z).

## Hosting actions

- No external action reported.
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-08-03T03:24:58.972Z).

## External side effects

- No external action reported.

## Blockers

- The zone still injects a bot-detection script, so a real publish will now record fingerprint_matches false until that setting changes

## Next exact action

Apply migration 0007_deployment_fingerprint, decide the Cloudflare Bot Fight Mode setting for sites.andtronai.com, then run the timed acceptance through Mission Control

## Definition of done

A deployment records what the public address actually served, and an unreadable address is never recorded as a match
