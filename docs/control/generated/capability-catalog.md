# Atlas Executable Capability Catalog

This file is generated from the executable Atlas capability registry and its
typed lifecycle metadata. An item listed only in the research or candidate
ledgers is not executable and does not appear here.

## Analytics
### `analytics.funnel` — Revenue pilot funnel
- Stage: candidate
- Phase: P2C
- Monetization: operations
- Autonomy: full-auto
- Implementation: build
- Regions: `global`
- Entitlements: `revenue-pilot`
- Evidence: none
- Specification: `docs/specs/p2/revenue-pilot.md`
- Method: GET
- Task class: quick
- Approval required: no
- Scopes: `leads:write`
- Description: Counts at every pilot stage with conversion between them, per\-channel counts that attribute nothing, and revenue per currency\. A rate with no denominator is reported as unknown, never as zero, and metrics nothing records are named rather than defaulted\.

## Customer Engagement
### `events.site` — Site event webhook
- Stage: candidate
- Phase: P2B
- Monetization: hosting
- Autonomy: threshold
- Implementation: build
- Regions: `global`
- Entitlements: `website-hosting`
- Evidence: `video-qy0l1t7x6le-follow-up-automation`, `video-qy0l1t7x6le-unified-conversations`, `video-qy0l1t7x6le-website-wedge`
- Specification: `docs/specs/p2/website-factory.md`
- Method: POST
- Task class: quick
- Approval required: no
- Scopes: `events:write`
- Description: Deployed sites post form/chat/call events here → conversation \+ qualification workflow\.

## Governance
### `approvals.decide` — Decide approval
- Stage: core
- Phase: P1
- Monetization: operations
- Autonomy: manual
- Implementation: build
- Regions: `global`
- Entitlements: `platform`
- Evidence: none
- Specification: `briefs/P1-CODEX-services.md`
- Method: POST
- Task class: quick
- Approval required: no
- Scopes: none
- Description: Operator\-only: approve/reject/defer with notes\. Executes held action on approve\.

### `approvals.list` — List pending approvals
- Stage: core
- Phase: P1
- Monetization: operations
- Autonomy: manual
- Implementation: build
- Regions: `global`
- Entitlements: `platform`
- Evidence: none
- Specification: `briefs/P1-CODEX-services.md`
- Method: GET
- Task class: quick
- Approval required: no
- Scopes: none
- Description: Pending approval queue for the declarative approval UI\.

## Intelligence Bank
### `memory.adjudicate` — Truth review decision
- Stage: core
- Phase: P1
- Monetization: operations
- Autonomy: manual
- Implementation: build
- Regions: `global`
- Entitlements: `platform`
- Evidence: none
- Specification: `briefs/P1-CODEX-services.md`
- Method: POST
- Task class: quick
- Approval required: yes
- Scopes: none
- Description: Operator resolves a conflicted node \(declarative approval UI\)\.

### `memory.answer` — Answer from memory
- Stage: core
- Phase: P1
- Monetization: platform
- Autonomy: threshold
- Implementation: build
- Regions: `global`
- Entitlements: `platform`
- Evidence: none
- Specification: `briefs/P1-CODEX-services.md`
- Method: POST
- Task class: quick
- Approval required: no
- Scopes: `memory:read`
- Description: Token\-ladder answer: cache → playbook → nodes → model\. Returns rung used \+ tokens spent\.

### `memory.distill` — Distill cards → nodes
- Stage: core
- Phase: P1
- Monetization: operations
- Autonomy: threshold
- Implementation: build
- Regions: `global`
- Entitlements: `platform`
- Evidence: none
- Specification: `briefs/P1-CODEX-services.md`
- Method: POST
- Task class: do
- Approval required: no
- Scopes: none
- Description: Scheduled: raw cards → decision\-memory nodes \(kind: fact\|decision\|procedure\|preference\) with truth filter\.

### `memory.ingest` — Ingest cards
- Stage: core
- Phase: P1
- Monetization: operations
- Autonomy: threshold
- Implementation: build
- Regions: `global`
- Entitlements: `platform`
- Evidence: none
- Specification: `briefs/P1-CODEX-services.md`
- Method: POST
- Task class: quick
- Approval required: no
- Scopes: `memory:write`
- Description: Local ingest agent pushes relevance\-filtered cards \(hash\-deduped\)\.

### `playbooks.author` — Author playbook \(departing genius\)
- Stage: candidate
- Phase: P2A
- Monetization: operations
- Autonomy: manual
- Implementation: build
- Regions: `global`
- Entitlements: `platform`
- Evidence: none
- Specification: `docs/specs/p2/intelligence-foundation.md`
- Method: POST
- Task class: think
- Approval required: yes
- Scopes: none
- Description: Budgeted frontier session whose deliverable is a versioned playbook\. Always logged as think\-class spend\.

## Mission Control
### `status.mission_control` — Mission Control status
- Stage: core
- Phase: P1
- Monetization: platform
- Autonomy: full-auto
- Implementation: build
- Regions: `global`
- Entitlements: `platform`
- Evidence: none
- Specification: `briefs/P1-CODEX-services.md`
- Method: GET
- Task class: quick
- Approval required: no
- Scopes: none
- Description: Home cards: model\-chain health, memory freshness, cache\-hit rate, $ saved, live runs, pending approvals\.

## Model Operations
### `bench.run` — Run model bench
- Stage: core
- Phase: P1
- Monetization: operations
- Autonomy: threshold
- Implementation: build
- Regions: `global`
- Entitlements: `platform`
- Evidence: none
- Specification: `briefs/P1-CODEX-services.md`
- Method: POST
- Task class: do
- Approval required: no
- Scopes: none
- Description: Scheduled: score models on eval task families; results feed the router\.

## Outreach
### `automation.sequence` — Plan an outreach sequence
- Stage: candidate
- Phase: P2C
- Monetization: acquisition
- Autonomy: manual
- Implementation: build
- Regions: `global`
- Entitlements: `revenue-pilot`
- Evidence: `video-qy0l1t7x6le-dashboard-navigation`, `video-qy0l1t7x6le-follow-up-automation`
- Specification: `docs/specs/p2/revenue-pilot.md`
- Method: POST
- Task class: do
- Approval required: no
- Scopes: `leads:write`
- Description: Plan an ordered set of touches for one lead\. Planning creates drafts only: each touch still needs its own policy check and its own named approval, and no touch can be sent from here\. A suppressed lead cannot be sequenced\.

### `outreach.send` — Send outreach message
- Stage: candidate
- Phase: P2C
- Monetization: acquisition
- Autonomy: shadow
- Implementation: integrate
- Regions: `global`
- Entitlements: `revenue-pilot`
- Evidence: `video-qy0l1t7x6le-multichannel-outreach`
- Specification: `docs/specs/p2/revenue-pilot.md`
- Method: POST
- Task class: quick
- Approval required: yes
- Scopes: none
- Description: One outreach touch \(email/SMS/WhatsApp draft\)\. ALWAYS approval\-gated\. Suppressed leads and a per\-space daily cap are refused before an approval is created\.

### `sequence.advance` — Record a touch outcome
- Stage: candidate
- Phase: P2C
- Monetization: acquisition
- Autonomy: manual
- Implementation: build
- Regions: `global`
- Entitlements: `revenue-pilot`
- Evidence: none
- Specification: `docs/specs/p2/revenue-pilot.md`
- Method: POST
- Task class: quick
- Approval required: no
- Scopes: `leads:write`
- Description: Move one touch by exactly one declared step\. Approval requires a real approved approvals row; recording a touch as sent is refused here and is only ever done by the approved outreach\.send dispatch\. A reply or an opt\-out stops the sequence\.

### `sequence.state` — Outreach sequence state
- Stage: candidate
- Phase: P2C
- Monetization: acquisition
- Autonomy: manual
- Implementation: build
- Regions: `global`
- Entitlements: `revenue-pilot`
- Evidence: none
- Specification: `docs/specs/p2/revenue-pilot.md`
- Method: GET
- Task class: quick
- Approval required: no
- Scopes: `leads:write`
- Description: The plan for one lead, what happened to each touch, and which touch is eligible next — or why none is\. Read\-only\.

## Prospecting
### `demos.advance` — Move a demo along
- Stage: candidate
- Phase: P2C
- Monetization: acquisition
- Autonomy: manual
- Implementation: build
- Regions: `global`
- Entitlements: `revenue-pilot`
- Evidence: `video-qy0l1t7x6le-prebuild-demos`
- Specification: `docs/specs/p2/revenue-pilot.md`
- Method: POST
- Task class: quick
- Approval required: no
- Scopes: `leads:write`
- Description: Advance one demo slot by exactly one declared step, or expire it\. A demo cannot jump past QA, and cannot be rewound\.

### `demos.enqueue` — Take a demo slot
- Stage: candidate
- Phase: P2C
- Monetization: acquisition
- Autonomy: manual
- Implementation: build
- Regions: `global`
- Entitlements: `revenue-pilot`
- Evidence: `video-qy0l1t7x6le-prebuild-demos`
- Specification: `docs/specs/p2/revenue-pilot.md`
- Method: POST
- Task class: do
- Approval required: no
- Scopes: `leads:write`
- Description: Admit a qualified prospect to the demo queue\. Refuses an unqualified or stale prospect, a prospect already holding a slot, and anything over the pilot cap of ten\.

### `leads.find` — Find leads
- Stage: candidate
- Phase: P2C
- Monetization: acquisition
- Autonomy: manual
- Implementation: integrate
- Regions: `global`
- Entitlements: `revenue-pilot`
- Evidence: `video-qy0l1t7x6le-google-maps-prospecting`
- Specification: `docs/specs/p2/revenue-pilot.md`
- Method: POST
- Task class: do
- Approval required: no
- Scopes: `leads:write`
- Description: Industry \+ location \+ criteria → scored lead table \(active GBP, no website\)\.

### `prospecting.qualify` — Qualify prospect
- Stage: candidate
- Phase: P2C
- Monetization: acquisition
- Autonomy: manual
- Implementation: build
- Regions: `global`
- Entitlements: `revenue-pilot`
- Evidence: none
- Specification: `docs/specs/p2/revenue-pilot.md`
- Method: POST
- Task class: do
- Approval required: no
- Scopes: `leads:write`
- Description: Score one sourced prospect against the pilot rubric and record an append\-only assessment\. Settled blockers disqualify; open questions send it to eligibility review\. Never writes leads\.status, which is the outreach lifecycle\.

### `prospecting.workspace` — Prospecting workspace
- Stage: candidate
- Phase: P2C
- Monetization: acquisition
- Autonomy: manual
- Implementation: build
- Regions: `global`
- Entitlements: `revenue-pilot`
- Evidence: `video-qy0l1t7x6le-google-maps-prospecting`, `video-qy0l1t7x6le-marketing-navigation`, `video-qy0l1t7x6le-prebuild-demos`
- Specification: `docs/specs/p2/revenue-pilot.md`
- Method: GET
- Task class: quick
- Approval required: no
- Scopes: `leads:write`
- Description: Review sourced prospects with their standing qualification verdict, demo slot and outreach readiness\. Read\-only; it decides nothing\.

## Revenue Operations
### `deals.decide` — Record a deal decision
- Stage: candidate
- Phase: P2C
- Monetization: hosting
- Autonomy: manual
- Implementation: build
- Regions: `global`
- Entitlements: `revenue-pilot`
- Evidence: none
- Specification: `docs/specs/p2/revenue-pilot.md`
- Method: POST
- Task class: quick
- Approval required: no
- Scopes: none
- Description: Record where a deal has got to: interested, discovery, offer\_review, accepted or declined\. Operator\-only — it records a human decision, it does not make one\. Reviewing or accepting requires a published offer version\.

### `hosting.activate` — Activate hosting
- Stage: candidate
- Phase: P2C
- Monetization: hosting
- Autonomy: shadow
- Implementation: build
- Regions: `global`
- Entitlements: `website-hosting`
- Evidence: `video-qy0l1t7x6le-free-hosting-offer`
- Specification: `docs/specs/p2/revenue-pilot.md`
- Method: POST
- Task class: quick
- Approval required: yes
- Scopes: none
- Description: Grant a customer hosting\. ALWAYS approval\-gated\. Refused before an approval is created, and again before the entitlement moves, unless terms were accepted on this exact offer version with every required disclosure and a payment reference is recorded\. Atlas never confirms a payment itself\.

### `hosting.cancel` — Cancel hosting
- Stage: candidate
- Phase: P2C
- Monetization: hosting
- Autonomy: shadow
- Implementation: build
- Regions: `global`
- Entitlements: `website-hosting`
- Evidence: none
- Specification: `docs/specs/p2/revenue-pilot.md`
- Method: POST
- Task class: quick
- Approval required: yes
- Scopes: none
- Description: Disable renewal for a customer\. ALWAYS approval\-gated\. Deletes no history, offer or export, and a customer who paid for the period keeps it\.

### `hosting.state` — Hosting state
- Stage: candidate
- Phase: P2C
- Monetization: hosting
- Autonomy: manual
- Implementation: build
- Regions: `global`
- Entitlements: `website-hosting`
- Evidence: none
- Specification: `docs/specs/p2/revenue-pilot.md`
- Method: GET
- Task class: quick
- Approval required: no
- Scopes: `leads:write`
- Description: The standing offer, deal decision and hosting entitlement for one lead\. Read\-only, and it never returns the payment reference itself — only whether one exists\.

### `offers.publish` — Publish an offer version
- Stage: candidate
- Phase: P2C
- Monetization: hosting
- Autonomy: manual
- Implementation: build
- Regions: `global`
- Entitlements: `revenue-pilot`
- Evidence: `video-qy0l1t7x6le-free-hosting-offer`
- Specification: `docs/specs/p2/revenue-pilot.md`
- Method: POST
- Task class: do
- Approval required: no
- Scopes: `leads:write`
- Description: Record an immutable offer for one lead\. Country, currency, price, period and terms version are all required — there is no default price and no USD assumption — and every disclosure the pilot requires must carry text\. A change is a new version, never an edit\.

## Runs
### `runs.execute` — Execute capability run
- Stage: core
- Phase: P1
- Monetization: platform
- Autonomy: threshold
- Implementation: build
- Regions: `global`
- Entitlements: `platform`
- Evidence: none
- Specification: `briefs/P1-CODEX-services.md`
- Method: POST
- Task class: do
- Approval required: no
- Scopes: `runs:write`
- Description: Create \+ run a capability with router\-selected model; logs tokens/cost/rung\.

## Website Factory
### `factory.build_site` — Build wedge site
- Stage: candidate
- Phase: P2B
- Monetization: acquisition
- Autonomy: manual
- Implementation: build
- Regions: `global`
- Entitlements: `website-factory`
- Evidence: `video-qy0l1t7x6le-ai-assisted-editor`, `video-qy0l1t7x6le-gbp-site-prompt`, `video-qy0l1t7x6le-generation-stages`, `video-qy0l1t7x6le-prebuild-demos`, `video-qy0l1t7x6le-template-library`, `video-qy0l1t7x6le-website-wedge`
- Specification: `docs/specs/p2/website-factory.md`
- Method: POST
- Task class: do
- Approval required: no
- Scopes: `factory:write`
- Description: GBP/FB profile → facts → declarative descriptor → template render → preview deploy\.

### `factory.deploy_site` — Deploy site live
- Stage: candidate
- Phase: P2B
- Monetization: hosting
- Autonomy: shadow
- Implementation: build
- Regions: `global`
- Entitlements: `website-hosting`
- Evidence: `video-qy0l1t7x6le-free-hosting-offer`, `video-qy0l1t7x6le-generation-stages`, `video-qy0l1t7x6le-presenter-pricing`
- Specification: `docs/specs/p2/website-factory.md`
- Method: POST
- Task class: quick
- Approval required: yes
- Scopes: none
- Description: Promote a demo site to live hosting\. Deploys are governed\. Required accessibility, responsive, link, structured\-data, privacy, security and performance checks are re\-run before an approval is created and again before the build is promoted\.

### `factory.preview` — Preview built site
- Stage: candidate
- Phase: P2B
- Monetization: acquisition
- Autonomy: manual
- Implementation: build
- Regions: `global`
- Entitlements: `website-factory`
- Evidence: none
- Specification: `docs/specs/p2/website-factory.md`
- Method: GET
- Task class: quick
- Approval required: no
- Scopes: `factory:write`
- Description: Re\-render a stored descriptor and return the immutable build\. Access\-controlled, expiring, noindex — never public\.
