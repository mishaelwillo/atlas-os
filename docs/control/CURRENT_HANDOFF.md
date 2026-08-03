# Current Handoff

**Handoff ID:** `pages-serves-every-live-site`
**Status:** active
**Started:** 2026-08-03T16:53:17.979Z
**Updated:** 2026-08-03T16:53:17.979Z
**Actor:** Claude
**Objective:** Stop each publish deleting every previously published site

## Active work

- Work item: `P2C-REVENUE-001`
- Branch: `fix/pages-serves-every-live-site`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `3909aa394feb9c5daca4349bf03c3da5ed05afef`
- Review status: pending independent review

## Task change evidence

- PublishTarget gains a required alsoServe set; the dispatcher gathers live siblings and refuses when one no longer reproduces its approved build

## Current working tree

- Clean.

## Verification evidence

- pnpm build, pnpm test (869 tests) and pnpm lint exit 0; sibling inclusion mutation-tested

## Database actions

- Moved both fixture deployments from live to rolled_back with an audit row each; no live deployment remains
- Observed Supabase status: ok (live-read-only at 2026-08-03T06:21:29.385Z).

## Hosting actions

- No external action reported.
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-08-03T06:21:29.385Z).

## External side effects

- Rolled Cloudflare Pages back to fe747724, its pre-fixture placeholder, taking both fixture sites down at the operator's request

## Blockers

- No rollback capability exists in the registry, so the takedown was a direct database write

## Next exact action

Decide the Cloudflare Bot Fight Mode setting, add a sweep that re-checks previously-live sites, and wire a rollback capability so takedowns stop needing direct database writes

## Definition of done

A publish keeps every already-live site served, or refuses
