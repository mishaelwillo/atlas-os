# Current Handoff

**Handoff ID:** `docs-migration-self-record`
**Status:** active
**Started:** 2026-07-28T07:09:22.130Z
**Updated:** 2026-07-28T07:09:22.130Z
**Actor:** Codex
**Objective:** Require migrations to record themselves so the schema cannot silently outrun the ledger

## Active work

- Work item: `P2B-FACTORY-001`
- Branch: `docs/migration-self-record`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `becfb15b81d76f44fa032af3595d5b982b85531a`
- Review status: pending independent review

## Task change evidence

- Documented the self-record requirement in the deployment runbook and the no-mistakes document instructions

## Current working tree

- ` M .no-mistakes.yaml`
- ` M docs/control/CURRENT_HANDOFF.md`
- ` M docs/control/DEPLOYMENT_RUNBOOK.md`
- `?? docs/control/handoffs/archived/2026-07-28-feat-publish-core.md`

## Verification evidence

- 0003 applied correctly with all columns, indexes and policies, but left the ledger reporting 0002 because the file did not self-record

## Database actions

- No external action reported.
- Observed Supabase status: ok (live-read-only at 2026-07-27T20:44:46.799Z).

## Hosting actions

- No external action reported.
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-07-27T20:44:46.799Z).

## External side effects

- No external action reported.

## Blockers

- Not supplied.

## Next exact action

Bump expected_migration to 0003 and update both service fingerprints once the ledger records it

## Definition of done

The active task acceptance checks pass and the handoff is updated.
