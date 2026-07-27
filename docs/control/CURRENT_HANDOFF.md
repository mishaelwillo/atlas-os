# Current Handoff

**Handoff ID:** `feat-factory-dossier`
**Status:** active
**Started:** 2026-07-27T05:17:06.919Z
**Updated:** 2026-07-27T05:17:06.919Z
**Actor:** Codex
**Objective:** Begin P2B Website Factory with the sourced dossier and descriptor foundation (P2B-FACTORY-001)

## Active work

- Work item: `P2A-MEMORY-001`
- Branch: `feat/factory-dossier`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `308a3f37a61bc232a0fad998d2d26cb866072d08`
- Review status: pending independent review

## Task change evidence

- factory.build_site now creates a draft site from a sourced dossier; unsourced and conflicting facts are blocked instead of rendered

## Current working tree

- ` M docs/control/CURRENT_HANDOFF.md`
- `?? docs/control/handoffs/archived/2026-07-27-feat-mission-control-cards.md`

## Verification evidence

- 13 dossier tests plus 7 route tests, 78/78 API tests, 14/14 workspace test tasks, uncached 8/8 builds; a mutation admitting unsourced facts failed 6 tests

## Database actions

- No external action reported.
- Observed Supabase status: ok (live-read-only at 2026-07-27T01:04:56.531Z).

## Hosting actions

- No external action reported.
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-07-27T01:04:56.531Z).

## External side effects

- No external action reported.

## Blockers

- Not supplied.

## Next exact action

Merge after review, then add the template library and deterministic renderer so a descriptor can produce a preview build

## Definition of done

The active task acceptance checks pass and the handoff is updated.
