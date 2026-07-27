# Current Handoff

**Handoff ID:** `fix-stale-bundle-detection`
**Status:** active
**Started:** 2026-07-27T05:32:45.698Z
**Updated:** 2026-07-27T05:32:45.698Z
**Actor:** Codex
**Objective:** Stop cached bundles from silently running outdated code against a current API

## Active work

- Work item: `P2A-MEMORY-001`
- Branch: `fix/stale-bundle-detection`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `1e6cc54307856b7e90518228c13c414229d07262`
- Review status: pending independent review

## Task change evidence

- The OS bundle now carries its build commit and warns when the server publishes a different one

## Current working tree

- ` M docs/control/CURRENT_HANDOFF.md`
- `?? docs/control/handoffs/archived/2026-07-27-feat-mission-control-cards.md`

## Verification evidence

- 11 staleness tests, 38/38 OS tests, 14/14 workspace test tasks, uncached 8/8 builds; a build with ATLAS_GIT_SHA set proved the commit is baked into the emitted bundle

## Database actions

- No external action reported.
- Observed Supabase status: ok (live-read-only at 2026-07-27T01:04:56.531Z).

## Hosting actions

- No external action reported.
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-07-27T01:04:56.531Z).

## External side effects

- No external action reported.

## Blockers

- index.html is served without Cache-Control by Railway's static SPA serving; this detects the symptom rather than fixing the header

## Next exact action

Merge, then hard-refresh the OS once to land on the current build and retry operator sign-in

## Definition of done

The active task acceptance checks pass and the handoff is updated.
