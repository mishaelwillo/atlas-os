# Current Handoff

**Handoff ID:** `feat-preview-viewer`
**Status:** active
**Started:** 2026-07-27T06:46:17.009Z
**Updated:** 2026-07-27T06:46:17.009Z
**Actor:** Codex
**Objective:** Add the sandboxed preview viewer to Atlas OS (P2B-FACTORY-001)

## Active work

- Work item: `P2A-MEMORY-001`
- Branch: `feat/preview-viewer`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `7a967a11721d28279747b9e1dd539b572be6223b`
- Review status: pending independent review

## Task change evidence

- Added a sites card to status.mission_control and an inline preview viewer rendering builds in a fully sandboxed iframe

## Current working tree

- ` M docs/control/CURRENT_HANDOFF.md`
- `?? docs/control/handoffs/archived/2026-07-27-feat-factory-preview.md`

## Verification evidence

- 5 viewer tests, 43/43 OS tests, 108/108 API tests, 14/14 workspace test tasks, uncached 8/8 builds; a mutation relaxing the sandbox to allow-same-origin allow-scripts failed a test

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

Merge after review; publishing needs real hosting, domain proof, and the owner-approval chain, which are decisions rather than code

## Definition of done

The active task acceptance checks pass and the handoff is updated.
