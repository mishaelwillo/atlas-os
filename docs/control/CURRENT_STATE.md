# Atlas Current State

## Generated observed state

The read-only collector is installed. A user-invoked `pnpm control:status`
refresh writes uncommitted `docs/control/generated/observed-state.json` and
`drift-report.md` with collection timestamps and provenance. If those files are
absent, no live refresh has been performed in the current worktree. Unknown
authority remains unknown; control artifacts never infer a successful live
state.

Reading the database requires injected credentials; `railway run --service api
pnpm control:status` supplies them.

## Repository state

- Authoritative `main`: `b97b9dcfd1ef2784bc6e751c223392b85b8b6a7e`.
- Twenty-three pull requests are merged, each with `Build & Test` green on the
  exact resulting `main` SHA. No merge has been made without that check.
- Both Railway services deploy automatically from `main` and have been observed
  reporting the merged SHA after each release.

## Production state

P1 is **complete**, including live acceptance. The Railway API serves the
selected commit, `POST /v1/memory/ingest` and `GET /v1/status/mission_control`
answer 401 auth-gated where they previously 404'd, and the drift report has no
blocking finding.

- Supabase migration `0002_intelligence_enrichment` is applied. Execution proof
  came from a transactional dry run against the real schema (`begin … rollback`)
  because no scratch database exists; only after that clean run was it applied,
  in one transaction with its ledger insert.
- The migration ledger is baselined. `supabase_migrations.schema_migrations` did
  not exist at all — `0001_init` had been applied outside the Supabase CLI — so
  exact migration identity was unprovable until the operator created it.
- `expected_migration` in `ENVIRONMENTS.yaml` and both services' reported
  schema version all read `0002_intelligence_enrichment`.

## Phase progress

- **P1** — complete. Deployment closure and both halves of live acceptance are
  verified against production.
- **P2A Intelligence Bank** — build-now scope done: card enrichment and the
  source-free quarantine, versioned playbook authoring under approval, and
  Mission Control drift and memory-freshness cards. The remaining agent audit
  views are candidates gated on an evidence decision.
- **P2B Website Factory** — build-now scope done: sourced descriptors, the
  template library with deterministic escaped rendering, access-controlled
  expiring previews with a sandboxed viewer, publish verification and rollback
  history, and the QA gate. The remaining acceptance is a timed benchmark run
  from profile URL to approved live demo.
- **P2C Revenue pilot** — outreach drafting exists in the product, and
  suppression plus a per-space daily cap are enforced before an approval is
  created. Prospect qualification and the demo queue are built and live, with
  migrations `0004` and `0005` applied and verified against the ledger, and
  outreach sequence state, offers, terms and hosting activation live alongside
  them — migrations `0004` through `0006` applied and verified against the
  ledger. The remaining build-now scope is funnel analytics and the operator
  surface. Lead sourcing still needs a directory adapter that does not exist.

## P1 acceptance

Token-authenticated acceptance passed against production: ingest admitted two
cards scoped to the `atlas` space; identical re-ingest returned
`admitted 0 / skipped 2`, proving the hash-dedupe contract; unauthenticated and
unknown-credential calls returned 401; `outreach.send` and `approvals.decide`
returned 403 operator-only; and each successful call wrote one `audit_log` row.
`messages` and `approvals` were both empty afterwards, so nothing was queued or
sent. The acceptance credential was disabled after the run.

The operator half passed on 2026-07-27, run entirely through Mission Control.
Two approvals were created and decided by the pinned operator, and both
dispatched: the audit trail records `outreach.send` with `requiresApproval`,
then `approvals.decide`, then `outreach.dispatched` with `stub: true`. Both a
hand-entered lead reference and a well-formed but non-existent uuid worked.
`messages` remained empty and no outbound row exists without `approved_by`, so
nothing left the system.

## Defects found and fixed

Each was found in production or by a gate, not in review:

- **Generated client sent an unbound `fetch`**, so every call through it threw
  before reaching the network. Fixed in the codegen template.
- **OS build-info asserted a migration it could not observe**, publishing a
  stale schema version. Absent now resolves to `unknown`.
- **The diagnostic override field captured the operator password.** It was a
  masked input with no autofill guard whose value silently replaced the session
  credential, so the password was transmitted in an authorization header on
  roughly a thousand requests. It is now opt-in and guarded. The credential was
  never logged or persisted, and it has since been rotated.
- **Cached bundles ran indefinitely old code**, because `index.html` is served
  without a `Cache-Control` header. The page now detects and reports staleness.
- **Authentication rejections were silent**, making a misconfiguration
  indistinguishable from a bad credential. Verification now names the reason.
- **Lint was a no-op.** The script and turbo task existed with no implementer
  and ESLint uninstalled, so CI ran no static analysis. It is now a real gate.

## Tooling

- ESLint with type-aware rules runs in CI after the build, which is required:
  the rules need the workspace declaration files.
- The `no-mistakes` gate is initialised on this repository with `claude` as the
  pipeline agent and telemetry disabled. `commands` and `agent` are read from
  the trusted default branch, so a pushed branch cannot change what executes.
  `origin` is untouched; pushing through the gate is opt-in per push.

## Site hosting

Published customer sites are hosted separately from Atlas itself. Atlas (the API
and operator dashboard) runs on Railway; generated business sites do not, and
that distinction is the whole reason a hosting adapter exists.

Provider is **Cloudflare Pages**, chosen because the domain already lives on
Cloudflare, static serving costs nothing there, and its deploy API is the seam
the publish core was built against.

- Pages project: `atlas-sites`, account `fd486ea72e20f31937e059f3d14ff0c2`.
- Default address: `https://atlas-sites-2np.pages.dev` — live, serving a
  `noindex` placeholder that lists nothing.
- Public address: `https://sites.andtronai.com` — serving. The Pages custom
  domain still reports `pending` while its certificate provisions, but the
  record is proxied so Cloudflare's edge terminates TLS and the address works.
- Zone `andtronai.com` is active in the same Cloudflare account
  (`9613c75aac8b84c6af05c19d9edc4aab`).
- Layout is path-based: each site publishes under `/<slug>`, where the slug
  carries a site-id suffix so two businesses sharing a name cannot collide.
  Switching to per-site subdomains changes one function, `publicUrl`.

### Outstanding hosting steps

1. **Done.** The `CNAME` `sites` → `atlas-sites-2np.pages.dev`, proxied, exists
   in the `andtronai.com` zone (record `443f05ad`). Proxied is correct for Pages
   because it is Cloudflare-native; the opposite applies to a Railway origin.
   The `wrangler login` credential is rejected by the DNS records API, so this
   was created through the authorised Cloudflare MCP server instead.
2. **Outstanding.** The deployed API cannot use a local `wrangler login`
   credential. Publishing from Atlas requires a scoped Cloudflare API token with
   Pages edit rights, set as `CLOUDFLARE_API_TOKEN` on the Railway `api`
   service, alongside `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_PAGES_PROJECT` and
   `ATLAS_SITES_BASE_URL`.

Until the credential exists, an approved publish is verified, versioned and
recorded as `queued`, and the adapter refuses rather than reporting an address
that does not serve.

### Recorded but not yet schema-backed

`ENVIRONMENTS.yaml` is a strict schema with no hosting section, so the values
above are prose rather than validated configuration. Extending the schema so
the collector can observe the Pages deployment is a genuine follow-up; until
then hosting drift is not detected.

## Build QA

A build runs twenty-eight checks — twenty-seven blocking, one advisory —
before it can be approved for publish, covering the seven categories the
Website Factory acceptance names:
accessibility, responsive, link, structured-data, privacy, security, and
performance. The gate runs twice — once before the approval row is created, so
an operator is never asked to approve an unpublishable build, and again in the
dispatcher before the build is handed to hosting, because the descriptor can
change in between.

Checks read only the rendered bytes and the descriptor: no network, no clock,
no headless browser. That keeps the verdict reproducible for the same build,
which is what lets it sit next to the fingerprint check without contradicting
it. Nothing is stored for the same reason a render is not stored — a saved
verdict could drift from the build it claims to describe, and it is cheaper to
recompute than to reconcile. The spec's `qa_result` table is therefore not
backed by a migration; if a QA history is ever wanted, that becomes real work.

Severity is real: a page over its 40 KB weight budget is reported as an
advisory and still publishes, while the 150 KB hard limit blocks. One check is
stricter than it may look — an outbound source link over plain `http` fails
`link.scheme`, because the dossier admits an http source and nothing else would
stop it reaching a published page.

## Prospect qualification and the demo queue

The pilot rubric is a pure function of recorded evidence. An operator supplies
what they found; the verdict and the six dimension scores are derived, so two
operators assessing the same prospect cannot record different totals, and a
stored verdict can be recomputed from the evidence beside it.

Two kinds of failure are kept apart, because the specification treats them
differently. A **blocker** is a settled fact — a duplicate, a closed business,
a demo that would misrepresent the prospect — and disqualifies. An **unknown**
is a question nobody has answered, and sends the prospect to eligibility review
rather than discarding it. A blocker outranks an unknown: answering every open
question does not make a closed business qualifiable.

The required checks are strict enough that any complete prospect scores at
least 22 of 30, so the qualifying threshold sits at 24 — inside the band it can
actually reach. Below that a complete prospect goes to a human instead of
being dropped.

Suppression is read from the lead row, never from the request. Nothing in this
path writes `leads.status`: that column is the outreach lifecycle, and letting
a qualification verdict write it would allow a disqualification to overwrite a
suppression.

The demo queue caps concurrent demos at ten and reports a queue under five as
thin without blocking it, which is the specification's 5–10 band. States move
forward only — `queued → building → qa → approved → shareable`, with `expired`
reachable from anything still in flight — so a demo cannot reach an owner
without passing the QA gate.

### Migration 0004 is applied

`supabase/migrations/0004_prospect_qualification.sql` created
`qualification_assessments` and `demo_queue`. The operator applied it on
2026-08-03; Claude had no permitted path to the database in that session.

Applied identity is proven, not assumed. `railway run --service api pnpm
control:status` read `0004_prospect_qualification` from
`supabase_migrations.schema_migrations` and both new tables from
`information_schema`, so the migration self-recorded as its final statement —
the step `0003` skipped, which is why the ledger drifted a version behind then.
`ENVIRONMENTS.yaml` pins `0004_prospect_qualification` and lists both tables.

The `schema_pending` path in these four capabilities is now unreachable in
production, and stays as the honest failure mode if the schema is ever behind
the code again — a 500 would be indistinguishable from a real fault, and a
fabricated success worse than either.

**Known wart.** Both `0003` and `0004` still carry a `REVIEW ONLY — NOT
APPLIED` banner, which is false for each. Applied migrations are immutable, so
neither file was edited to say otherwise. Nothing cross-checks that banner
against `expected_migration`, so it will keep going stale; teaching
`control:verify` to fail on it is a real follow-up.

There is no operator UI for these yet. Wiring Mission Control to endpoints that
currently report `schema_pending` would put a surface in front of an operator
that cannot do anything; it belongs with the funnel analytics work.

## Outreach sequence state

A sequence plans touches and records what happened to them. It cannot send, and
— the part that took the most care — it cannot *record* a send. The specification
says `automation.sequence` "plans state but cannot bypass per-touch checks", so
that is enforced structurally rather than asserted:

- `scheduled → sent` is refused to every caller. The only code that may make
  that move is the approved `outreach.send` dispatcher, which passes an internal
  flag no request body can set. Recording a send that no dispatch performed
  would make the audit trail claim an external effect that never happened.
- `approval_required → approved` requires an approvals row that exists **and**
  has status `approved`. Any other string is not an approval.
- A suppressed lead cannot be sequenced at all — the refusal happens at planning
  time, not one approval screen away from a mistake.

Only one touch may be in flight per sequence, enforced both in the rules and by
a partial unique index. If two could run at once, "each touch is separately
eligible, capped and approved" would stop meaning anything, because a reply to
the first would arrive after the second had already gone out. Touches are spaced
at least 48 hours apart, a channel may carry at most one touch, and a sequence
plans at most four — more is the aggressive frequency the MVP excludes.

A reply or an opt-out stops the whole sequence. A failed send does not: it ends
that touch without ending the plan.

### What is deliberately not enforced

Region packs carry `preferred_channels`, but the specification states that North
American SMS and Caribbean WhatsApp preference "are availability hints, not
permission". So channel preference gates nothing here; what gates a touch is the
approval it cannot be sent without. The packs also carry no quiet hours, so none
are enforced — inventing a window would be worse than not having one.

### Migration 0005 is applied

`supabase/migrations/0005_outreach_sequences.sql` created `outreach_sequences`
and `outreach_touches`. The operator applied it on 2026-08-03.

Verified the same way as `0004`: `railway run --service api pnpm control:status`
read `0005_outreach_sequences` from the migration ledger and both tables from
`information_schema`, 23 public tables in total. `ENVIRONMENTS.yaml` pins the
identity and lists both tables, and `ATLAS_SCHEMA_VERSION` is set to it on both
services.

The `schema_pending` path in the three sequence capabilities is now unreachable
in production, and the `outreach.send` dispatch records the touch rather than
reporting that it could not.

## Offers, terms and hosting activation

The acceptance is "hosting cannot activate before approved terms and confirmed
payment", so that is one gate decided in one place and checked twice: once
before the approval row is created, so an operator is never shown an approval
the dispatcher will refuse, and again in the dispatcher, because a deal can be
withdrawn or a payment reference removed in between. Both read the same facts
through the same function; if they read different things they could disagree,
and the approval queue would become where the decision was really made.

Activation requires all four: an accepted deal, on the *same* offer version the
entitlement is for, whose disclosures were complete, plus a recorded payment
reference. The offer-version check is not pedantry — a customer who accepted
last quarter's price must not be activated onto this quarter's, and an offer
revised after acceptance is a new offer needing a new decision.

Twelve disclosures must carry text before an offer can be published at all:
site and domain ownership, hosting and security scope, support and edit
boundary, data portability, renewal, taxes, cancellation and refund,
suspension, and migration. The specification names them, so they are a
checklist rather than prose — a refusal has to be able to say which one is
missing.

### Two things this deliberately will not do

**No default price and no default currency.** The presenter's figures — 100/119
monthly hosting, 2,000 for a website, 50/100 hourly, and the caption-rendered
9.97 — are recorded as unvalidated observation, not Atlas price policy. A
default would quietly turn one of them into policy. Zero is accepted as a real
price, because the pitch is a free site with hosting-only payment; absent is
refused, because "free" and "nobody said" must not look the same to the person
accepting it.

**Atlas never confirms a payment.** `billing.manage` is deferred to P3, so no
provider is integrated. A confirmed payment is a fact an operator records with
the provider's own reference, and that reference is all that is stored — no
card data, no token that can move money. `hosting.state` never returns the
reference itself, only whether one exists.

Cancellation disables renewal and deletes nothing: no history, no offer, no
export. A customer who paid for the period keeps it, because cancelling is not
a refund and taking a paid-for site down early would be worse service than the
thing being cancelled.

### Migration 0006 is applied

`supabase/migrations/0006_offers_and_hosting.sql` created `offers`,
`deal_decisions` and `hosting_entitlements`. The operator applied it on
2026-08-03.

Verified the same way as `0004` and `0005`: `railway run --service api pnpm
control:status` read `0006_offers_and_hosting` from the migration ledger and
all three tables from `information_schema`, 26 public tables in total. The
`schema_pending` path in these five capabilities is now unreachable in
production.

## Awaiting a decision

None of these is blocked on code:

- **A model credential**, without which `playbooks.author` records the
  operator's brief rather than running a frontier session.
- **Promoting `agents.logs`** from candidate, which carries a recorded evidence
  gap for unreadable source material.
- **A directory adapter** for lead sourcing, which keeps the leads list empty.

## Next exact action

Run the operator half of P1 acceptance through Mission Control: sign in, select
the `atlas` Space, draft an outreach touch, and approve it. Then continue the
revenue-pilot build-now scope, or resolve one of the decisions above.
