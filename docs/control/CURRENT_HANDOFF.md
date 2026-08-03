# Current Handoff

**Handoff ID:** `schedule-live-sweep`
**Status:** active
**Started:** 2026-08-03T20:03:01.528Z
**Updated:** 2026-08-03T20:03:56.998Z
**Actor:** Claude
**Objective:** Run the live-site sweep without anyone remembering to run it

## Active work

- Work item: `P2C-REVENUE-001`
- Branch: `feat/schedule-live-sweep`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `28d302955265cf63b4a05f461d3bb00726378673`
- Review status: pending independent review

## Task change evidence

- The worker runs factory.verify_live hourly per space, outside the schedules table

## Current working tree

- `M  docs/control/CURRENT_HANDOFF.md`

## Verification evidence

- pnpm build, pnpm test (892 tests) and pnpm lint exit 0; the interval floor and the keep-going-on-failure guards each mutation-tested

## Database actions

- No external action reported.
- Observed Supabase status: ok (live-read-only at 2026-08-03T06:21:29.385Z).

## Hosting actions

- No external action reported.
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-08-03T06:21:29.385Z).

## External side effects

- No external action reported.

## Blockers

- Scheduling a deterministic capability through the schedules table records a model's prose as a succeeded run, because runs.execute never invokes handlers

## Next exact action

Decide whether the registry should say which capabilities are model-run and which are deterministic, so runs.execute stops answering scheduled deterministic capabilities with model prose; decide the Cloudflare Bot Fight Mode setting; wire a rollback capability

## Definition of done

A live site that stops serving its approved build is reported on a timer rather than when someone loads it
