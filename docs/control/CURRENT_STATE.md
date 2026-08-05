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
  ledger — and funnel analytics complete the build-now scope. Mission Control
  now has cards covering all twelve, so the pilot can be run through the
  product. The funnel is
  empty because lead sourcing still needs a directory adapter that does not
  exist, which is what now blocks the pilot's exit criterion.

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

### Hosting is now schema-backed and observed

`ENVIRONMENTS.yaml` has a `hosting` section — provider, account, Pages project,
provider and public addresses, zone, layout, and the variable *names* the
publisher needs. It is required on every environment rather than optional,
because an optional section is one a future environment can silently omit,
which is how the gap appeared in the first place.

The collector reads what the running API is actually configured with and
compares it, producing five blocking findings that previously had no detector
at all: `hosting.account_mismatch`, `hosting.pages_project_mismatch`,
`hosting.base_url_mismatch`, `hosting.variables_unset` and
`hosting.public_address_unreachable`. The base-URL check matters most — the
address is recorded on the deployment row and read back to produce a
fingerprint, so publishing against the wrong base makes every recorded address
and every fingerprint taken from it describe somewhere the site is not.

The hourly `factory.verify_live` sweep catches the symptom of a live site not
serving its approved build. These catch the cause.

**No credential is in the file or the output.** Only variable names are
declared, and the collector reports presence per name, never a value.

**Unobserved is unknown, not agreement.** Run without the API environment
injected, hosting reports `hosting.configuration_unknown` as a warning rather
than manufacturing four mismatches against undefined. That costs one detector
honestly: removing *every* hosting variable at once is indistinguishable from
not looking. Removing any one of them, the realistic regression, is still
caught.

Verified against production on 2026-08-04: `railway run --service api pnpm
control:status` reported hosting `ok` with all four variables set and
`sites.andtronai.com` answering 200. The detector was then made to fail —
declaring a different Pages project produced
`BLOCKING hosting.pages_project_mismatch` naming both values — and restored.

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

**Fixed.** `0002` through `0006` all shipped carrying a `REVIEW ONLY — NOT
APPLIED` banner that was false for every one of them, because nothing checked.
The claim is now banned rather than maintained: `control:verify` fails with
`control.migration_claims_applied_state` on any applied-state assertion in a
migration comment, in either direction, and `expected_migration` is left as the
single authority. Removing the banners touched comment lines only — the
non-comment content of each file hashes identically before and after.

The operator UI for these now exists — see *The P2C operator surface* below.
It was deliberately built after the migrations were applied: wiring Mission
Control to endpoints still reporting `schema_pending` would have put a surface
in front of an operator that could not do anything.

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

## Funnel analytics

`analytics.funnel` counts every stage the pilot passes through and reports the
conversion between them. The same computation feeds a `funnel` card in
`status.mission_control`, so the operator surface stays declarative — the UI
renders that JSON rather than fetching anything of its own.

It is built to refuse three specific lies:

- **A rate with no denominator is unknown, not zero.** Nothing entering a stage
  means the conversion cannot be known. "0% reply rate" on a pilot that has sent
  nothing is worse than "—", because the first invites someone to go and fix
  messaging that was never sent. The card renders null as an em dash, and both
  halves are mutation-tested.
- **A metric nobody records is not zero either.** Provider cost, labour,
  support time, satisfaction, time-per-stage and demo cost have no source in the
  schema. They are named as unavailable rather than defaulted to zero and folded
  into a margin, and no gross-margin figure is reported at all.
- **Channel counts are not attribution.** The specification asks for "channel
  sequence contribution (not assumed causation)", so per-channel numbers carry
  an explicit `attribution: none`.

Two counting decisions worth knowing. A touch counts toward every milestone it
passed rather than only its current state, so sends do not appear to fall as
replies arrive. And the standing qualification verdict is counted once per
prospect, so the qualification rate does not drift with how often prospects are
re-assessed.

If any funnel table is missing the whole report refuses, because a partial
funnel — some stages counted, others silently zero — would read as a funnel
where everybody dropped out.

### The funnel is empty, and that is the finding

Nothing has entered it. Lead sourcing still has no directory adapter, so there
are no prospects to qualify, no demos to queue and no sequences to run. The card
says so in those terms rather than showing zeros that look like failure. The
pilot's exit criterion — one real hosting-paying customer — is blocked on that
adapter, not on any of the code built for P2C.

### Not verified

The card was not exercised in a signed-in browser. Mission Control needs an
operator password Claude has never had, so verification stopped at component
tests, the shape of the `status.mission_control` payload, and the built bundle.

## P2B benchmark run, 2026-08-03

Run against production on `b799878` with an operator-authorised HS256 token,
because Mission Control's password is not available to Claude. It therefore
measures the machine path, **not** the specification's thirty-minute
acceptance: the facts were prepared in advance and submitted programmatically,
so none of the research, entry or review time the budget exists to bound was
incurred. P2B stays in `review` for that reason.

The chain itself completed end to end:

| step | at |
| --- | --- |
| `factory.build_site` — 28 QA checks passed | +1.01s |
| `factory.preview` — hash matches the build | +1.66s |
| `factory.deploy_site` — approval created | +2.13s |
| `approvals.decide` — dispatched, status `live` | +4.32s |
| public address returns 200 | +4.75s |

### It found a defect that had never let a site serve

The first run failed at the provider: `8000096: A "manifest" field was expected
in the request body but was not provided`. The Pages deployments endpoint takes
multipart/form-data with the manifest as a form field; the adapter sent JSON.
**No site had ever been published.** The adapter's own test asserted the same
wrong shape the adapter sent, so nineteen passing tests confirmed only that the
code matched its author's misunderstanding of the provider contract.

It was recoverable because the dispatcher records a failed publish as `queued`
carrying the provider's reason rather than claiming an address that never
served. Fixed in `b799878`, and the re-run published.

### The public fingerprint does not equal the approved build

The acceptance is "public fingerprint equals approved build". Measured both
ways:

- **Pages origin** `atlas-sites-2np.pages.dev/<slug>` — 2,205 bytes, sha256
  `13b4d140…`, **exactly the approved build hash**, no script tags. The publish
  path is correct.
- **Public address** `sites.andtronai.com/<slug>` — 3,143 bytes, sha256
  `b9957589…`, carrying an injected `/cdn-cgi/challenge-platform/scripts`
  block.

The difference is Cloudflare **JS Detections** (Bot Fight Mode) rewriting the
response on the proxied `andtronai.com` record. It is a zone setting, not an
Atlas defect — but it means the page the public receives contains an executable
script nobody approved, which is precisely what the QA gate's
`security.no-executable-script` and `privacy.no-third-party-resources` exist to
prevent. The CSP the renderer emits (`default-src 'none'`) would stop it
executing, which is luck rather than design.

The zone setting is now fixed, and the cause was not what it looked like.
Bot Fight Mode was a red herring: with `fight_mode` already false the injection
continued, because the responsible setting is **`enable_js`** — Cloudflare's
JavaScript Detections — which the dashboard renders as read-only text inside
the Bot Fight Mode card with no toggle of its own.

It also cannot be changed by API token on this zone. A token scoped to Zone
Settings Edit is refused with `10000 Authentication error` on
`/zones/{id}/bot_management`; only an authenticated dashboard session is
accepted. It was set through that session with
`PUT /api/v4/zones/{id}/bot_management {"enable_js": false}`.

Measured immediately afterwards, `sites.andtronai.com` and the Pages origin
serve **byte-identical** content — 785 bytes each. The acceptance "public
fingerprint equals approved build" can now hold.

One follow-up remains, not taken unilaterally:
1. **Built.** The dispatcher now reads the published address back and records
   what it actually served: `public_fingerprint`, `fingerprint_checked_at` and
   `fingerprint_matches` on `site_deployments` (migration `0007`). An
   unreachable address records as unreadable, never as a match — a row carrying
   a verified-looking fingerprint that nothing verified would be worse than no
   read-back. A mismatch does not un-publish anything: the site is serving, and
   saying otherwise would be its own inaccuracy.
   Migration `0007` is applied and verified against the ledger.

   **A test double cannot catch bad SQL.** The first read-back attempt reached
   production and failed with `42P08: could not determine data type of
   parameter $9` — an uncast parameter inside a null test, which Postgres
   cannot infer a type for. Every unit test passed, because `FakeDb` records
   statements without parsing them. Any statement that touches the schema needs
   a transactional dry run against the real database before it ships; the fake
   proves handler logic and nothing about SQL.

### The fixtures are taken down, and taking them down found more

Both fixture sites were removed at the operator's request: Cloudflare Pages was
rolled back to `fe747724`, its pre-fixture placeholder from 2026-07-28, and both
`site_deployments` rows moved from `live` to `rolled_back` with an audit row
each. No live deployment remains.

That write went straight to the database, because at the time there was no
rollback capability — `planRollback` was a tested pure function nothing routed
to. Each change was audited so the trail was not silent, but a direct write is
a weaker thing than a governed one. `factory.rollback` now exists, so the next
takedown goes through the capability surface.

### The read-back raced the CDN

The first read-back to run after the zone was fixed still recorded a mismatch —
and its observed hash was **exactly the Pages placeholder's**. A freshly
created deployment is not instantly reachable, so reading once, immediately
after publishing, hashes whatever the provider serves in the meantime.

A non-match is now retried — six attempts, two seconds apart — before it is
believed. A match returns at once, because a matching hash cannot be a
propagation artefact, and exhausting the attempts records the last result
honestly rather than giving up into a pretend success. The policy is injected,
so tests do not sleep through it.

This is the second time the same mistake was made in this codebase: the
benchmark runner's own check treated any 200 as success and read the
placeholder too. Both are now encoded rather than remembered.

## Revising and withdrawing

Two gaps the production verification run exposed, both now closed.

**A site had exactly one descriptor for ever.** `factory.build_site` only ever
inserted, so a site could never reach version 2 and `factory.rollback` had
nothing to restore — the capability was correct and unreachable.
`factory.revise_site` replaces a descriptor with a new fact set. It touches the
draft only: the live deployment keeps serving the bytes it published, because
those are retained with it. Every sourcing and QA rule applies again, since new
facts deserve the same scrutiny as the first ones.

**Nothing could take a site down.** Rollback restores an earlier version; it
cannot withdraw one. Both fixture takedowns were direct database writes
recorded as `rolled_back`, which reads as a restore that never happened.
`factory.unpublish` is approval-gated like publishing, and migration `0010`
gives withdrawal a state of its own rather than borrowing a misleading one.

Because the provider deploys a whole-site snapshot, withdrawing one site means
republishing every other live site without it. Their bytes come from what each
actually published — never re-rendered — so nothing can drift, and if any of
those bytes were never retained the withdrawal is **refused** rather than
taking another site down as collateral. Withdrawing the last live site needs an
explicit empty snapshot, which is what the adapter's `withdrawAll` is for.

That byte-preference also fixed a latent trap: siblings used to be re-rendered,
so revising one site's descriptor would have made its live deployment look
drifted and blocked every other site's publish.

## Rollback

`factory.rollback` is approval-gated, like publishing: the specification makes
publish and rollback privileged and audited. It restores the last deployment
that was **observed serving** — `went_live_at` is set, not merely a row saying
`live` — and whose exact bytes were retained.

Wiring it exposed that nothing kept those bytes. A deployment recorded the
sha256 of what it published and nothing else, and a hash cannot be republished.
Re-rendering the descriptor does not recover the old build either: the
descriptor is the thing that changed, which is usually why someone is rolling
back. Migration `0009` — applied — retains `build_html` with each deployment, and a
predecessor without it is refused with `no_stored_build` rather than having
something rendered in its place — that would republish a build nobody approved
under the name of one that was.

The restore is a new version pointing at what it restored, never a revived row,
so history stays append-only. It carries every other live site along, reads the
address back, and retains its own bytes so the restore is itself
rollback-able.

All three deployment rows that predate `0009` carry no bytes, so rollback
becomes usable for a site one publish after the migration rather than
immediately. That is the honest state, not a defect: those bytes were never
retained and nothing can invent them.

**A Pages deployment is a whole-site snapshot, not a patch.** The adapter built
each deployment's manifest from the one site being promoted, so every publish
silently deleted every previously published site. It was found by loading the
first fixture after the second was published: 404, while its deployment row
still read `live`. The adapter's comment claimed "one project can host many
businesses"; it could host exactly one.

Fixed by carrying every already-live site into each deployment. The dispatcher
re-derives their bytes by re-rendering each stored descriptor, and requires each
re-render to reproduce the hash that site's deployment recorded. When one does
not, the publish is **refused** — dropping the site takes a paying customer
offline, and shipping the new bytes publishes something nobody approved, so a
refusal that blocks until someone looks is the least-bad of the three.

`factory.verify_live` closes the other half. The post-publish read-back proves
the deployment being made and says nothing about the ones made before it, which
is why a site could sit answering 404 for an hour while its row read `live`.
The sweep walks every live deployment, compares what its address serves against
the build approved for it, and stamps `fingerprint_checked_at` on each — a
fingerprint checked ten minutes ago and one checked in March are different
kinds of evidence, and only the timestamp tells them apart.

It changes no deployment state. A site that has gone wrong is still the site
that is public, and marking it otherwise would move the record further from
reality rather than closer. An unreadable address counts as unhealthy, not as
probably fine: counting it otherwise would reproduce the silence that let the
original defect last an hour. Only failures are audited, so a clean sweep does
not bury the trail under evidence that nothing happened.

The worker runs it hourly, per space that has something live, with the interval
overridable by `ATLAS_VERIFY_LIVE_INTERVAL_MS` and floored at five minutes so a
misconfigured value cannot turn it into a load test on customer sites. A drift
finding is logged at error level, because a live site not serving its approved
build is the condition the whole mechanism exists to surface.

It runs on its own timer rather than through the `schedules` table, which is
now a preference rather than a necessity: that path was fixed separately, and
the sweep's dedicated interval keeps a platform health check out of tenant
automation.

## How a capability executes

Every registry entry declares `execution: 'handler' | 'model'`. A `handler`
capability does real work in its own code and a run invokes it; a `model`
capability's deliverable is the router's answer. Only `memory.answer` and
`memory.distill` are model-answered — they are the token ladder.

Before this, `runs.execute` sent **every** non-approval capability to the model
router. Scheduling a deterministic check produced a `succeeded` run carrying a
model's prose about work that never happened, and the run's cost column
recorded tokens spent describing it. "Has a handler" could not be the
discriminator, because every capability has a handler entry and several are
typed stubs that throw — which is exactly the honest outcome for those: a
failed run rather than an invented answer.

The field is required, not defaulted. A default would put the next capability
back in the same hole; declaring it is the point.

A handler-executed run records `answered_by = 'handler'` (migration `0008`,
applied, widens the token-ladder check — confirmed by inserting such a row and
rolling it back) and no tokens or cost, because no model was called. Recording a deterministic run as `model` would put a model's name
against work no model did.

**Two capabilities had no handler entry at all.** `hosting.activate` and
`hosting.cancel` were added approval-gated, so nothing reached for them and
nothing complained — the handler map's own header claimed completeness was
asserted in tests, and no such test existed. It does now, and the stubs exist.

### What the run left in production

In the `studio` space: two sites, two approvals, two deployments — one `queued`
from the failed attempt, one `live`. The fixture is deliberately fictional
("Atlas Acceptance Test Plumbing", every fact owner-provided, so nothing is
attributed to a source that did not say it), the page carries `noindex`, and it
is still serving at
`https://sites.andtronai.com/atlas-acceptance-test-plumbing-5bb7da70`.

## The P2C operator surface

The twelve revenue capabilities were built, migrated and deployed with Mission
Control cards for none of them, so the pilot could only be run through the API.
Three cards close that: **prospects and the demo queue**, **outreach
sequences**, and **offers, deals and hosting**. An operator can now qualify a
prospect, queue and move a demo, plan and advance a sequence, publish an offer
version, record a deal decision, and see hosting state without leaving the
product.

They follow the same doctrine as every other card. The data arrives in
`status.mission_control`; the components call capabilities only to *act*, never
to read what they display. One pipeline read feeds all three, so they cannot
disagree about the state of a lead — three separate reads could, and the lead
they disagreed about would be the one someone was mid-decision on.

### What is derived rather than restated

A second hand-written copy of a rule is a claim nothing checks, so three things
are published by the API instead:

- The moves a demo may make come from `planAdvance`.
- The moves a touch may make come from `planTouchAdvance`, probed *without* the
  dispatcher flag. `sent` therefore cannot appear in any control, and a
  `scheduled` touch — whose only transition is to `sent` — arrives with no
  operator move at all, which the card states in those terms.
- The rubric thresholds, outreach channels, deal states, offer periods and the
  twelve required disclosures.

Both derivations are mutation-tested: replacing either with a fixed list fails
tests, and asserting the dispatcher flag makes `sent` offerable and fails three.

### Two distinctions the forms keep

**Unknown is not false.** Every rubric field that can be unanswered is a
three-way control, and an unanswered one is omitted from the request rather
than sent as `false`. The rubric disqualifies on a settled `false` and only
sends to review on an unknown, so a checkbox would have quietly disqualified
prospects nobody had checked.

**Blank is not zero.** The offer form has no default price and no default
currency, and a blank price is refused by name. Zero is a real price — the
pitch is a free site with hosting-only payment — so it must be possible to send
and impossible to send by accident.

### What the cards refuse to claim

`demos.enqueue`, `demos.advance`, `automation.sequence`, `sequence.advance`,
`offers.publish` and `deals.decide` all answer 200 with a `false` flag and a
reason when they refuse. Reporting only the absence of an exception would show
an operator a queued demo that was never queued, so every refusal is rendered
as one, with its code. `hosting.activate` and `hosting.cancel` are
approval-gated and report as queued for approval — never as an activation.

### Verification

The pipeline SQL was dry-run against production inside one rolled-back
transaction, with fixture rows inserted first: an empty result proves the
statements parse and nothing else. That run confirmed `distinct on` picks the
newer of two assessments, the touches join their sequence, a `scheduled` touch
is offered no move, and the payment reference does not reach the card. Every
P2C table was verified empty afterwards, so the rollback left nothing behind.

**Not verified.** The cards were not exercised in a signed-in browser. Mission
Control needs an operator password Claude has never had, so verification
stopped at the API payload, component tests driving the real component tree,
the card-routing test, and the built bundle.

## The full factory loop, proven end to end on 2026-08-04

Publish → revise → publish v2 → roll back → withdraw, run against production
with a fictional fixture (`atlas-loop-proof-plumbing-8a77aee4`, every fact
owner-provided, `noindex`). `factory.rollback` and `factory.unpublish` had
never fired against production before this; both now have.

| step | result |
| --- | --- |
| `factory.build_site` | 28 QA checks passed, hash `8161608b` |
| publish v1 | live; read-back recorded **mismatch** (see below) |
| `factory.revise_site` | new draft `3af0543e`; the live deployment kept serving v1, confirmed by fetching it |
| publish v2 | **failed with a 500** — the defect below |
| publish v2, after the fix | live, supersedes v1, fingerprint **match** |
| `factory.rollback` | v3 restoring v1's bytes, live; settled to a match |
| `factory.unpublish` | withdrawn, `stillServing: 0` |

Afterwards the address returns 404, the Pages placeholder still serves at the
root, every version retains its bytes so the history stays rollback-able, and
the sweep reports `checked: 0, healthy: true`. No live deployment remains.

### It found a defect that made a second publish impossible

`site_deployments_one_live` is a partial unique index on `(site_id) where
status = 'live'`. Both the deploy and the rollback dispatchers ran the
step-down **after** the insert, so it could never run — the insert violated the
index first. **No site could ever be published twice.**

Worse, the 500 arrived *after* the bytes had reached Cloudflare. The
transaction rolled back, so the record still said v1 was live while the
provider served v2, and the row carried `fingerprint_matches: true` for bytes
that were no longer served. The hourly sweep detected exactly that and reported
`drifted`, which is the compensating control working as designed.

`factory.rollback` had the identical ordering and had never run against a real
database, so nothing had hit it. The deploy dispatcher's own comment asserted
the invariant its code violated — "the previous one must step down as this one
arrives" — which is one more claim nothing checked.

Fixed by moving the step-down above the insert in both dispatchers. They share
the request's transaction, so a failing insert now rolls the step-down back
with it rather than demoting a deployment for a publish that never landed.

**A test double could not have caught this.** `FakeDb` records statements
without enforcing indexes, and the existing test asserted the step-down
happened but never that it happened *first*. Both dispatchers now have an
ordering test, and the real constraint was exercised in a transactional dry
run: the old order is rejected with `23505 site_deployments_one_live`, the new
order leaves exactly one live row.

### The read-back's retry budget is too short — open

Two of the three publishes recorded a false `mismatch`. In both cases the
address was serving the correct bytes within a minute, and the sweep
subsequently recorded a match. The read-back retries six times two seconds
apart — about twelve seconds — which is not enough for a first publish to a
path Cloudflare has not served before.

Nothing is wrong with the publish; the record is simply pessimistic, and a
`fingerprint_matches: false` on a healthy site is the kind of false alarm that
teaches an operator to ignore the field. Widening the budget trades publish
latency for accuracy, so it is recorded here as a decision rather than taken
unilaterally.

## Awaiting a decision

None of these is blocked on code:

- **A model credential**, without which `playbooks.author` records the
  operator's brief rather than running a frontier session.
- **Promoting `agents.logs`** from candidate, which carries a recorded evidence
  gap for unreadable source material.
- **A directory adapter** for lead sourcing, which keeps the leads list empty.
- **Widening the post-publish read-back budget** past its current six attempts
  two seconds apart, which currently records a false mismatch on a first
  publish. It trades publish latency for an accurate first record.

## Next exact action

Exercise the P2C cards in a signed-in browser: sign in, select a Space, and
walk one prospect from assessment through demo slot, sequence, offer and deal
decision to a hosting activation request. That needs an operator session Claude
does not have. Then resolve one of the decisions above — the directory adapter
is what still blocks the pilot's exit criterion.
