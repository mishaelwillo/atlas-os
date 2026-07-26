# Current Handoff

**Handoff ID:** `atlas-p2-specification-set`
**Status:** active
**Started:** 2026-07-26
**Updated:** 2026-07-26
**Actor:** Codex
**Objective:** Install the evidence-backed P2 build specifications and complete the capability/research/region work item.

## Active work

- Work item: `P2A-MEMORY-001`
- Branch: `codex/atlas-continuity`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `a8772dfbfc594734246bd1a2a4fa3f8a9d350bbe`
- Review status: pending independent review

## Task change evidence

- Six build specifications now cover regional packs, intelligence, Website
  Factory, revenue pilot, recurring upsells, and their index.
- The presenter workflow is preserved as a supervised start-to-finish playbook.
- The menu crosswalk preserves only validated observed labels and explicitly
  keeps unreadable AI-agent sub-tabs pending research.
- Static verification now checks spec paths, required boundaries/staging,
  candidate and executable evidence resolution, observed-label coverage, and the
  AI-agent evidence gap.
- Executable P2 capability metadata now points to its specific owning spec and
  the generated catalog was refreshed.

## Current working tree

- Clean after the Task 5 code/docs boundary; this handoff update is metadata-only.

## Verification evidence

- RED: focused suite failed because the specification validator did not exist.
- GREEN: focused control-schema suite passed 155 of 155 tests after all required
  specs and the evidence-backed crosswalk were installed.
- Full workspace tests passed 219 of 219; build passed 8 of 8 packages.
- Static control verification, required-section/staging scans, 53 retained
  artifact hashes, registry catalog regeneration, API/client generation diffs,
  source diff, whitespace check, and focused secret scan passed.

## Database actions

- No database mutation or additional live refresh performed.
- Last generated Supabase status remains unknown; this work does not reinterpret it.

## Hosting actions

- No hosting mutation, deployment, or additional live refresh performed.
- Railway API continues to have recorded blocking P0-versus-P1 route drift.

## External side effects

- Created local code/docs commit `a8772dfbfc594734246bd1a2a4fa3f8a9d350bbe`;
  no push, deploy, message send, billing action, or other external write.

## Blockers

- P1 production deployment closure remains ready/critical and blocking the P1
  production-complete claim.
- It does not invalidate local P2A specification work, but must remain visible.

## Next exact action

Reconcile `docs/specs/p2/intelligence-foundation.md` with the existing P1 memory
implementation and write the smallest test-first P2A implementation plan while
keeping `P1-DEPLOY-001` ready and the production drift visible.

## Definition of done

The Intelligence Bank implementation plan maps existing code/data boundaries,
identifies only the P2A delta, includes region/evidence/governance acceptance
tests, and does not claim the live P1 API is current.
