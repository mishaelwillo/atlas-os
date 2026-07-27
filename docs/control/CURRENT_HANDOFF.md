# Current Handoff

**Handoff ID:** `fix-auth-failure-observability`
**Status:** active
**Started:** 2026-07-27T07:10:06.877Z
**Updated:** 2026-07-27T07:10:06.877Z
**Actor:** Codex
**Objective:** Make operator token rejections diagnosable instead of silent

## Active work

- Work item: `P2A-MEMORY-001`
- Branch: `fix/auth-failure-observability`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `0bf88be0be157949571e73d0feadf39aef9592d6`
- Review status: pending independent review

## Task change evidence

- verifyOperatorJwt and verifyJwksSignature now report a specific failure reason, logged at warn level by the pipeline

## Current working tree

- ` M docs/control/CURRENT_HANDOFF.md`
- `?? docs/control/handoffs/archived/2026-07-27-feat-factory-preview.md`

## Verification evidence

- 7 new failure-reason tests, 115/115 API tests, 14/14 workspace test tasks, uncached 8/8 builds

## Database actions

- No external action reported.
- Observed Supabase status: ok (live-read-only at 2026-07-27T01:04:56.531Z).

## Hosting actions

- No external action reported.
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-07-27T01:04:56.531Z).

## External side effects

- No external action reported.

## Blockers

- The production 401 cause is still unknown; this change is what will reveal it

## Next exact action

Merge, deploy, then read the API log to learn the exact reason the operator JWT is refused

## Definition of done

The active task acceptance checks pass and the handoff is updated.
