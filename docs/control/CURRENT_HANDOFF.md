# Current Handoff

**Handoff ID:** `fix-site-builder-usability`
**Status:** active
**Started:** 2026-08-02T21:03:23.084Z
**Updated:** 2026-08-02T21:03:23.084Z
**Actor:** Claude
**Objective:** Make the site builder card readable and its fields self-explanatory

## Active work

- Work item: `P2B-FACTORY-001`
- Branch: `fix/site-builder-usability`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `a058cdd9272fd2ad1cbd055387b9b2f00bcb6ef1`
- Review status: pending independent review

## Task change evidence

- Stacked fact rows vertically so the source input and owner checkbox no longer overflow behind the next card
- Replaced the free-text field box with a picker of template-declared fields, since renderSection only emits those
- Seeded one row per required field and required a value before counting a field as supplied

## Current working tree

- ` M docs/control/CURRENT_HANDOFF.md`
- `?? docs/control/handoffs/archived/2026-08-02-feat-site-builder-card.md`

## Verification evidence

- 19 builder tests, 81/81 OS tests, lint 0, 8/8 builds; mutation reverting supplied-requires-value failed 3 tests

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

Merge, deploy, and confirm the card renders inside its column with the source input visible

## Definition of done

The builder fits its grid column, field names are chosen from the template, and the sourcing requirement is visible while entering.
