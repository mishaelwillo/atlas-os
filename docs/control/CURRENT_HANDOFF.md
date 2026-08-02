# Current Handoff

**Handoff ID:** `feat-site-builder-card`
**Status:** active
**Started:** 2026-08-02T20:00:10.419Z
**Updated:** 2026-08-02T20:00:10.419Z
**Actor:** Codex
**Objective:** Let an operator build a site from the product rather than an API call (P2B-FACTORY-001)

## Active work

- Work item: `P2B-FACTORY-001`
- Branch: `feat/site-builder-card`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `7ff38574255eaf5e5521e1031e349e39e0ad0d8a`
- Review status: pending independent review

## Task change evidence

- Added a site builder card with per-fact sourcing, template requirements surfaced from the server, and blocked-gap reporting

## Current working tree

- ` M docs/control/CURRENT_HANDOFF.md`
- `?? docs/control/handoffs/archived/2026-08-02-feat-publish-live.md`

## Verification evidence

- 13 builder tests, 204/204 API tests, 75/75 OS tests, lint 0, uncached 8/8 builds; a mutation sending both a source and the owner marker failed 2 tests

## Database actions

- No external action reported.
- Observed Supabase status: ok (live-read-only at 2026-07-28T09:07:53.146Z).

## Hosting actions

- No external action reported.
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-07-28T09:07:53.146Z).

## External side effects

- No external action reported.

## Blockers

- Not supplied.

## Next exact action

Merge and deploy, then build a site and approve its publish to confirm it serves on sites.andtronai.com

## Definition of done

The active task acceptance checks pass and the handoff is updated.
