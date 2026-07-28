# Current Handoff

**Handoff ID:** `feat-expect-0003`
**Status:** active
**Started:** 2026-07-28T07:13:24.638Z
**Updated:** 2026-07-28T07:13:24.638Z
**Actor:** Codex
**Objective:** Advance expected schema to 0003 now that the migration and ledger agree

## Active work

- Work item: `P2B-FACTORY-001`
- Branch: `feat/expect-0003`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `40481d1b7a562c72ccf1fe2ae47cc4006353ce49`
- Review status: pending independent review

## Task change evidence

- Bumped expected_migration to 0003_site_deployments, added site_deployments to the required table set, and updated both service schema fingerprints

## Current working tree

- ` M docs/control/CURRENT_HANDOFF.md`
- ` M docs/control/ENVIRONMENTS.yaml`
- `?? docs/control/handoffs/archived/2026-07-28-docs-migration-self-record.md`

## Verification evidence

- 0003 verified applied with all columns, indexes and policies; ledger reports 0003_site_deployments; the schema-claim drift check caught both services before their fingerprints were updated

## Database actions

- None. The migration and its ledger row were applied by the operator
- Observed Supabase status: ok (live-read-only at 2026-07-28T07:12:14.950Z).

## Hosting actions

- No external action reported.
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-07-28T07:12:14.950Z).

## External side effects

- No external action reported.

## Blockers

- Not supplied.

## Next exact action

Create the sites service and point sites.andtronai.com at it, then wire the hosting target

## Definition of done

The active task acceptance checks pass and the handoff is updated.
