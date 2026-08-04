# Current Handoff

**Handoff ID:** `deployment-supersede-order`
**Status:** active
**Started:** 2026-08-04T23:56:25.963Z
**Updated:** 2026-08-04T23:56:25.963Z
**Actor:** Claude
**Objective:** Prove the full factory loop against production and fix what it finds

## Active work

- Work item: `P2C-REVENUE-001`
- Branch: `fix/deployment-supersede-order`
- Base commit: `e98e40298a12becf19bff58d7226e567e315da53`
- Head commit: `19de49d435787cef5a522796cbd6156264073a88`
- Review status: pending independent review

## Task change evidence

- Moved the live step-down before the deployment insert in both the deploy and rollback dispatchers, and added ordering tests to each

## Current working tree

- Clean.

## Verification evidence

- transactional dry run against production: old order rejected with 23505 site_deployments_one_live, new order leaves exactly one live row; reverting the order fails both tests

## Database actions

- No external action reported.
- Observed Supabase status: ok (live-read-only at 2026-08-04T22:57:39.336Z).

## Hosting actions

- Published a fictional fixture site to sites.andtronai.com to exercise the loop; still live and to be withdrawn when the loop completes
- Observed Railway API status: ok; OS status: ok (live-read-only at 2026-08-04T22:57:39.336Z).

## External side effects

- No external action reported.

## Blockers

- Production serves v2 of the fixture while its deployment row says v1; re-publishing on the fixed build reconciles it

## Next exact action

Resume the loop on the deployed fix: publish v2, roll back to v1, withdraw, and confirm nothing is left live

## Definition of done

publish, revise, publish v2, rollback and unpublish all succeed against production with record and reality agreeing
