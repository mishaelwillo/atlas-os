# Current Handoff

**Handoff ID:** `p2b-benchmark-result`
**Status:** active
**Started:** 2026-08-03T05:44:02.794Z
**Updated:** 2026-08-03T05:44:02.794Z
**Actor:** Claude
**Objective:** Record the P2B benchmark run and what it found

## Active work

- Work item: `P2C-REVENUE-001`
- Branch: `docs/p2b-benchmark-result`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `5c2f0f94de617f82dd4a38ecf603d54c84bab1fb`
- Review status: pending independent review

## Task change evidence

- Not supplied.

## Current working tree

- Clean.

## Verification evidence

- Pages origin serves sha256 13b4d140 which equals the approved build hash exactly; the proxied public address serves b9957589 with an injected cdn-cgi challenge-platform script

## Database actions

- The two runs created two sites, two approvals and two deployments in the studio space, one queued and one live
- Observed Supabase status: ok (live-read-only at 2026-08-03T03:24:58.972Z).

## Hosting actions

- No external action reported.
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-08-03T03:24:58.972Z).

## External side effects

- Published a fictional acceptance-test site, still serving at sites.andtronai.com/atlas-acceptance-test-plumbing-5bb7da70 and carrying noindex

## Blockers

- The public fingerprint does not equal the approved build because the zone injects a bot-detection script, so the P2B acceptance does not pass

## Next exact action

Decide the Cloudflare Bot Fight Mode setting for sites.andtronai.com, add a post-publish fingerprint read-back, and run the timed acceptance through Mission Control

## Definition of done

The benchmark result and both findings are recorded against the specification they bear on
