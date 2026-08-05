# Atlas OS — Manual

What this system is, what it does, and how it is built. Conceptual rather than
exhaustive: the specifications in `docs/specs/p2/` own the detail, and
`docs/control/CURRENT_STATE.md` owns what is true right now.

## What Atlas is

Atlas builds and hosts small business websites, and runs the supervised
commercial process around them: find a prospect, qualify them, build a demo
site, offer hosting, and serve the ones who accept.

Two things make it unusual, and they are the same thing seen twice:

**Every action is a capability.** Not a route, not a script — a declared entry
in one registry, from which the API routes and the typed client are generated.
A capability that is not in `packages/registry/registry.ts` does not exist.

**The system is built to be unable to lie about itself.** Almost every defect
found in this project was a claim that nothing checked: a migration banner that
still said "NOT APPLIED" after it ran, a comment claiming one hosting project
could serve many businesses when it could serve exactly one, a handler map whose
header said its completeness was "asserted in tests" that did not exist. The
response each time was not to reword the claim but to make it checkable and let
the check fail first.

## The shape of it

```
  Operator (browser)
        │
   Mission Control ── renders declarative JSON, calls capabilities only to ACT
        │
      API ── registry → generated routes → auth → approval gate → handler
        │                                            │
   Supabase                                    dispatcher (the only place
   (tenant data,                                a held action executes)
    audit, approvals)                                │
        │                                    Cloudflare Pages
        └── control plane ── observes reality and reports drift    (published sites)
```

- **`apps/api`** — the capability surface. One pipeline: authenticate, check
  scope, run pre-approval gates, either execute a handler or park an approval.
- **`apps/os`** — Mission Control, the operator's screen. It renders the JSON
  that `status.mission_control` returns. Cards do not fetch their own data; they
  call capabilities only to *act*.
- **`packages/registry`** — the single source of truth. Codegen writes
  `apps/api/src/routes.gen.ts` and `packages/client/src/client.gen.ts`.
- **`packages/control-schema`** — the control plane: static verification, a
  read-only collector that observes live reality, and drift detection.
- **`supabase/migrations`** — schema, applied by a human, pinned in
  `docs/control/ENVIRONMENTS.yaml`.

## The three ideas worth understanding

### 1. The approval gate

A capability declares `requiresApproval`. If it does, calling it **never**
reaches a handler: it writes an approvals row and stops. Only
`apps/api/src/dispatch.ts` executes a held action, and only after a named human
decides it.

Pre-approval gates live in `pipeline.ts` so an operator is never shown an
approval the dispatcher would refuse. The same facts are checked twice — once
before the approval exists, once before the effect happens — because things
change in between. If those two checks read different data they could disagree,
and the approval queue would quietly become where the decision was really made.

Capabilities with empty `scopes` are operator-only.

### 2. Honest degradation

Every capability answers with what is true, including when that is
disappointing:

- A capability whose tables are missing reports `schema_pending` and changes
  nothing, rather than throwing a 500 that is indistinguishable from a real
  fault.
- A failed publish records `queued` with the provider's reason, never an
  address that does not serve.
- An address that cannot be read records `unreadable`, never a match.
- A rate with no denominator is `null` and renders as an em dash, never `0%`.
  "0% reply rate" on a pilot that has sent nothing invites someone to go and fix
  messaging that was never sent.
- A metric nothing records is *named as unmeasured*, not defaulted to zero.

This extends to the UI. Several capabilities answer HTTP 200 carrying
`{ enqueued: false, code, note }`. The cards render those as refusals, because
reporting only the absence of an exception would show an operator a queued demo
that was never queued.

### 3. Derived, never restated

Where a rule exists, the surface asks the rule rather than keeping a copy.

The moves a demo may make come from `planAdvance`. The moves a touch may make
come from `planTouchAdvance`, probed *without* the dispatcher flag — so `sent`
can never be offered to an operator, and a `scheduled` touch correctly arrives
with no move at all. Deal moves come from `planDealTransition`. The rubric
thresholds, outreach channels, offer periods and the twelve required
disclosures are all published by the API.

A second hand-written copy is a claim about the rules that nothing checks. Deals
were the one control that restated them, and it offered four moves the API
refused — found by driving the pilot in a browser, not by review.

## What it does, end to end

### The website factory (P2B)

1. **`factory.build_site`** — sourced facts become a declarative descriptor,
   rendered deterministically. Same descriptor + template → byte-identical HTML
   and the same sha256. Every displayed fact needs a source URL or an explicit
   owner-provided marker; unsourced facts are recorded as gaps and never
   rendered.
2. **QA** — 28 checks (27 blocking, one advisory) across accessibility,
   responsive, link, structured-data, privacy, security and performance. Run
   before the approval is created *and* again before the build is promoted.
3. **`factory.deploy_site`** — approval-gated. Publishing promotes exactly the
   approved build.
4. **Read-back** — the published address is fetched and hashed. A non-match is
   retried on a backoff budget of about a minute before it is believed, because
   a CDN that has not propagated is not a defect.
5. **`factory.verify_live`** — hourly, walks every live deployment and every
   unconfirmed withdrawal, comparing what is served against what was approved.
   It changes no state: a site that has gone wrong is still the site that is
   public.
6. **`factory.revise_site` / `rollback` / `unpublish`** — revise touches the
   draft only; rollback restores a build that was *observed serving* and whose
   bytes were retained; unpublish withdraws and then confirms the address
   actually stopped serving.

A Pages deployment is a whole-site snapshot, so every publish carries every
other live site with it, from the bytes each actually published.

### The revenue pilot (P2C)

`leads.record` → `prospecting.qualify` → `demos.enqueue`/`advance` →
`automation.sequence` → `sequence.advance` → `offers.publish` →
`deals.decide` → `hosting.record_terms` → `hosting.activate` → `hosting.state`,
with `analytics.funnel` counting all of it.

The qualification rubric is a pure function of recorded evidence: an operator
supplies what they found, and the verdict and six dimension scores are derived,
so two operators cannot record different totals. It keeps two failures apart —
a **blocker** is a settled fact that disqualifies, an **unknown** is a question
nobody has answered and sends the prospect to review. A blocker outranks an
unknown.

A sequence plans touches and records what happened. It cannot send, and — the
part that took the most care — it cannot *record* a send. `scheduled → sent` is
refused to every caller; only the approved `outreach.send` dispatch may make
that move.

Offers are immutable versions with no default price and no default currency.
Zero is a real price, because the pitch is a free site with hosting-only
payment; absent is refused, because "free" and "nobody said" must not look the
same to the person accepting it.

**Atlas never confirms a payment.** A confirmed payment is a fact an operator
records with the provider's own reference, and a reference shaped like a card
number is refused.

## Using it

Mission Control at `https://os-production-8faf.up.railway.app`. Sign in as the
operator, then **select a Space** — every governed action requires one.

The cards you will use for the pilot:

- **Prospects and demo queue** — record a prospect by hand (with where you found
  them), assess them against the rubric, take a demo slot, move it one step at a
  time.
- **Outreach sequences** — plan an ordered set of touches, record what happened
  to each. Planning approves nothing.
- **Offers, deals and hosting** — publish an offer version, record where the
  deal has got to, record accepted terms, request activation.
- **Pending approvals** — where every held action waits for you. The outcome
  line tells you what the dispatcher actually did, including "approved, but
  nothing executed".

## What it deliberately will not do

No autonomous cold outreach. No purchased or unknown contact lists. No implied
consent. No stored payment credentials. No default prices taken from
unvalidated research. No legal conclusions. No capability that scrapes around a
provider's terms.

Models cannot send, call, accept terms, charge, activate billing, or raise their
own caps. `runs.execute` will not answer a deterministic capability with a
model's prose — every registry entry declares `execution: 'handler' | 'model'`,
and only the two token-ladder capabilities are model-answered.

## Working on it

```bash
pnpm build && pnpm lint && pnpm test && pnpm control:verify
```

Lint runs after build in CI because the type-aware rules need workspace
declaration files. The discipline that matters most:

- **Check exit codes.** `cmd | grep X || echo CLEAN` prints CLEAN when the
  command crashes.
- **A test double cannot catch bad SQL, or a constraint.** `FakeDb` records
  statements without parsing them. Anything touching the schema gets a
  transactional dry run (`begin … rollback`) against the real database first.
- **A test written from the same assumption as the code proves nothing.** The
  Pages adapter once asserted the same wrong request shape it sent; nineteen
  passing tests confirmed only that the author's misunderstanding was
  self-consistent, and no site had ever published.
- **Mutation-test every guard.** Break it deliberately, watch the tests fail,
  restore. A guard with no failing mutation is decoration.
- **Anything crossing a CDN must settle before you believe it.**
- **Green CI on a branch does not prove main is green.** Confirm the run on the
  exact merged SHA — and match the run to that SHA, because watching "the latest
  run" straight after a merge can watch the previous one.
