# Current Handoff

**Handoff ID:** `atlas-capabilities-research-regions-task-2-review-fix`
**Status:** active
**Started:** 2026-07-24T18:24:00.000-04:00
**Updated:** 2026-07-25T19:47:44.6126734-04:00
**Actor:** Codex
**Objective:** Add validated inherited regional packs for Atlas's initial global, North American, and Caribbean coverage.

## Active work

- Work item: `P2A-CAPABILITIES-001`
- Branch: `codex/atlas-continuity`
- Base commit: `2f9e77c35fd0ee2be54ce243e8f47ed2ea744cb8`
- Head commit: `a47d70edb1b09a823becfdb98d618a3b489ca22c`
- Review status: pending independent re-review

## Task change evidence

- Capability Task 2 base: `2f9e77c35fd0ee2be54ce243e8f47ed2ea744cb8`.
- Capability Task 2 code and configuration boundary:
  `4f441777c95b43f007df2daab4a2e8c8693382f6`.
- Capability Task 2 review-fix boundary:
  `a47d70edb1b09a823becfdb98d618a3b489ca22c`.
- Eight region packs form the hierarchy global → North America or Caribbean →
  country without application-code forks.
- Country values replace supplied parent values; omitted values inherit.
  Language variants merge in stable parent-first order so localized English
  retains the global English fallback.
- Regional data contains no legal conclusions or market prices. Every initial
  pack resolves to shadow autonomy, required operator approval, and required
  jurisdictional policy review.
- The review fix exposes a canonical package root without removing prior
  schema, loader, handoff, observation, drift, or verifier APIs; removes
  country-local languages from aggregate packs; and rejects duplicate values
  in every regional array.
- Boundary note: `2327bd78ea9bb802d3adf665e7469cb91c0e0b2f`
  is the metadata-only commit between the original code boundary and review
  fix. The commit following the review-fix boundary is also metadata-only and
  changes only this handoff and work-queue next action.

## Current working tree

- Clean after the metadata-only handoff commit.

## Verification evidence

- TDD RED: the new regional suite failed to load because `regions.ts` did not
  exist; the pre-existing 87 control-schema tests remained green.
- Focused GREEN: 17 of 17 regional tests passed, and the full control-schema
  suite passed 105 of 105 tests.
- Negative coverage rejects malformed ISO-like country, currency, language,
  and phone-region codes; unknown channels, directories, and review platforms;
  unknown keys; duplicate IDs; unknown parents; inheritance cycles; incomplete
  roots; and unsafe outreach autonomy or approval values.
- Static-verifier regression proves an invalid regional pack produces the
  blocking `control.region_packs_invalid` finding.
- All eight packs parsed and resolved deterministically independent of input
  order. Saint Lucia resolves global English, Caribbean WhatsApp preference,
  and `XCD`; the United States resolves the
  global → North America → United States chain and `USD`.
- The 8-package build passed; all 161 workspace tests passed; static control
  verification passed; API/client generated artifacts remained byte-stable;
  and `git diff --check` passed.
- Review-fix RED: the source package entry did not exist, five country packs
  leaked aggregate or sibling locales, and all seven duplicate-array fixtures
  were accepted. The focused run reported 18 failures while the 17 original
  regional tests stayed green.
- Review-fix focused GREEN: 2 package-entry tests and 35 regional tests passed.
  Exact language resolution is United States `[en, en-US]`, Canada
  `[en, en-CA, fr-CA]`, Saint Lucia `[en, en-LC]`, Jamaica `[en, en-JM]`, and
  Trinidad and Tobago `[en, en-TT]`; global and both aggregate packs resolve to
  `[en]`.
- A clean control-schema build followed by a real
  `import('@atlas/control-schema')` exposed `resolveRegionPack`,
  `EnvironmentFileSchema`, `WorkQueueSchema`, and `loadControlFiles`.
- Review-fix full GREEN: control-schema passed 125 of 125 tests; the 8-package
  build and all 181 workspace tests passed; `pnpm control:verify` passed;
  generated API/client artifacts remained byte-stable; and `git diff --check`
  passed.

## Database actions

- No database mutation performed.

## Hosting actions

- No hosting mutation performed.

## External side effects

- Created local commit `4f441777c95b43f007df2daab4a2e8c8693382f6`;
  no push, deployment, database mutation, hosting mutation, or external write
  performed.
- Created local review-fix commit
  `a47d70edb1b09a823becfdb98d618a3b489ca22c`; no push, deployment, database
  mutation, hosting mutation, or external write performed.
- The required read-only `pnpm control:status` check refreshed ignored local
  generated observations and reconfirmed the known Railway route blocker; it
  performed no external mutation.

## Blockers

- Production P1 deployment closure remains blocked by the Railway API serving the P0 route set.

## Next exact action

Independently re-review Capability Task 2 from base
`2f9e77c35fd0ee2be54ce243e8f47ed2ea744cb8` through exact review-fix boundary
`a47d70edb1b09a823becfdb98d618a3b489ca22c`; only after approval, execute Task
3 of the approved Atlas capabilities, research, and regions plan using tests
first, with a code commit followed by a metadata-only handoff commit.

## Definition of done

The Capability Task 2 re-review confirms no important or critical findings
remain. Task 3 stays gated until that approval; afterward its video research
evidence ledger must pass focused tests, cross-reference verification, static
control verification, and independent review.
