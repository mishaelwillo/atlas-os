# Atlas Executable Capability Catalog

This file is generated from the executable Atlas capability registry and its
typed lifecycle metadata. An item listed only in the research or candidate
ledgers is not executable and does not appear here.

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
- Description: One outreach touch \(email/SMS/WhatsApp draft\)\. ALWAYS approval\-gated; daily cap enforced\.

## Prospecting
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
- Description: Promote a demo site to live hosting\. Deploys are governed\.

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
