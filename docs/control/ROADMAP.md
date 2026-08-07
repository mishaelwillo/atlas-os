# Atlas Roadmap

## Phase model

- P0 — AntiGravity scaffold and initial Railway/Supabase deployment.
- P1 — Claude core services; exit: code, CI, and live acceptance pass.
- P1 deployment closure — exit: Railway API fingerprint matches selected P1 commit and P1 routes exist.
- P2A — Intelligence Bank, continuity controls, capability lifecycle, and regional packs.
- P2B — Website Factory; exit: GBP/profile URL to approved live demo in under 30 minutes.
- P2C — Revenue pilot; exit: one real hosting-paying customer through an approval-gated sequence.
- P3 — Recurring-service expansion: reputation, SEO/AEO, social, email, ads, and richer agents.

## Sequencing

**Phase status lives in `WORK_QUEUE.yaml`, not here.** This section used to
restate it — "the P2A continuity foundation is complete, the capability
lifecycle work is next" — and went stale the moment that work merged, then
stayed stale through two more completed phases. A second copy of a status the
queue already owns is a claim nothing checks, and this one was wrong for
months. What follows is the dependency reasoning, which does not change as work
completes.

- **P1 deployment closure** gates the P1 production completion claim, because a
  passing test suite says nothing about what the deployed fingerprint serves.
- **P2B and P2C** both depend on the P2A foundation: the capability registry,
  the research ledger and the regional packs are what make a factory capability
  or a revenue capability governable rather than merely present.
- **P2C depends on P2B**, since the pilot sells the thing the factory builds.
- **P3 follows evidence from the revenue pilot**, deliberately. Recurring-service
  expansion built before one customer has been served would be built on nothing
  observed — which is why P2C's exit demands a cost and outcome record as well
  as a customer. The record is the evidence P3 is sequenced behind.
