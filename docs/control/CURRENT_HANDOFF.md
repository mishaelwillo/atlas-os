# Current Handoff

**Handoff ID:** `fingerprint-readback-race`
**Status:** active
**Started:** 2026-08-04T19:51:13.124Z
**Updated:** 2026-08-04T19:51:13.124Z
**Actor:** Claude
**Objective:** Stop the read-back recording a propagation artefact as a mismatch

## Active work

- Work item: `P2C-REVENUE-001`
- Branch: `fix/fingerprint-readback-race`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `d5b111c4afa488ff8e6e6b806a1ca4e2f32f4184`
- Review status: pending independent review

## Task change evidence

- readBackUntilSettled retries a non-match; the retry policy is injected through deps

## Current working tree

- Clean.

## Verification evidence

- The production mismatch observed 5442c033, which is exactly the Pages placeholder hash; the address served the approved build e3acc9bc seconds later

## Database actions

- No external action reported.
- Observed Supabase status: ok (live-read-only at 2026-08-04T03:42:40.880Z).

## Hosting actions

- No external action reported.
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-08-04T03:42:40.880Z).

## External side effects

- Published a verification fixture at sites.andtronai.com/atlas-fingerprint-proof-plumbing-cecb30dc, still live

## Blockers

- factory.rollback cannot fire in the product: nothing updates a descriptor, so a site never reaches version 2

## Next exact action

Take the verification fixture down, then run the timed P2B acceptance through Mission Control

## Definition of done

A publish whose address settles to the approved build records a match, not a mismatch
