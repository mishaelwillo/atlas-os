# Current Handoff

**Handoff ID:** `feat-factory-preview`
**Status:** active
**Started:** 2026-07-27T06:23:21.537Z
**Updated:** 2026-07-27T06:23:21.537Z
**Actor:** Codex
**Objective:** Add access-controlled expiring preview builds for the Website Factory (P2B-FACTORY-001)

## Active work

- Work item: `P2A-MEMORY-001`
- Branch: `feat/factory-preview`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `766a6dc4bc6f612e82055a246209364359f55d13`
- Review status: pending independent review

## Task change evidence

- Added the factory.preview capability, its lifecycle metadata, and moved the pinned executable capability count from 15 to 16

## Current working tree

- ` M docs/control/CURRENT_HANDOFF.md`
- `?? docs/control/handoffs/archived/2026-07-27-feat-factory-renderer.md`

## Verification evidence

- 10 preview tests, 108/108 API tests, 20/20 registry tests, 14/14 workspace test tasks, uncached 8/8 builds; a mutation disabling the expiry gate failed a test

## Database actions

- No external action reported.
- Observed Supabase status: ok (live-read-only at 2026-07-27T01:04:56.531Z).

## Hosting actions

- No external action reported.
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-07-27T01:04:56.531Z).

## External side effects

- No external action reported.

## Blockers

- No evidence record names factory.preview, so it claims none; it derives from the owning specification

## Next exact action

Merge after review, then add the preview viewer in Atlas OS using a sandboxed iframe so the build never runs in the authenticated origin

## Definition of done

The active task acceptance checks pass and the handoff is updated.
