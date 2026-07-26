# Atlas P2 Integrated Specification Set

## Purpose

This is the build authority for turning the presenter-observed website wedge into
an Atlas-native, global, governed product. It preserves the method as a testable
hypothesis without copying a vendor interface or treating sales claims as fact.

Execution sequence:

```text
P2A continuity + intelligence + regions
→ P2B research + descriptor + template + generation + verification + publishing
→ P2C prospecting + demo queue + outreach + hosting conversion
→ P3 reputation + SEO/AEO + social + email + ads + richer agents
```

The operational narrative is in
`docs/specs/p2/presenter-workflow-playbook.md`; source-to-Atlas navigation is in
`docs/specs/p2/menu-crosswalk.md`.

## Users

- Operator: researches prospects, verifies facts, approves sites and outreach.
- Business owner: reviews the demo, terms, content, and hosting activation.
- Platform administrator: governs regions, integrations, entitlements, and audit.
- Analyst: measures funnel, service outcomes, evidence quality, and unit economics.
- Builder/model: implements only the owning specification and declared lifecycle.

## Inputs and outputs

Inputs are validated evidence IDs, region packs, tenant policy, capability
metadata, sourced business facts, operator decisions, and measured outcomes.
Outputs are versioned descriptors, previews, approvals, deployments, funnel
events, service recommendations, and auditable learning—not unverifiable claims.

## UI and menu

Atlas menus are entitlement-driven: Mission Control, Intelligence Bank,
Website Factory, Prospecting, Outreach, Customer Engagement, Growth, Governance,
and Settings. Presenter labels remain a source crosswalk only.

## Workflow and states

`evidence → candidate → specified → experiment → validated → production`, with
`deferred`, `rejected`, and `retired` branches. P1 production drift remains
blocking even while local P2 specification work proceeds.

## Data entities

`evidence_record`, `capability_definition`, `region_pack`, `work_item`,
`business_profile`, `source_fact`, `site_descriptor`, `site_version`, `approval`,
`deployment`, `prospect`, `outreach_touch`, `entitlement`, `offer_experiment`,
`service_assessment`, and immutable `audit_event`.

## APIs, events, and integrations

Executable routes come only from the registry. Adapters isolate directory,
hosting, messaging, calendar, payment, review, social, email, and advertising
providers. Events carry tenant, region, actor, source, correlation, consent,
approval, capability version, and outcome fields.

## Permissions, approvals, and autonomy

Tenant isolation and least privilege are mandatory. Research and drafting may
run in shadow/threshold modes. Public publishing, first-contact outreach,
payment activation, ad spend, review responses, and destructive changes require
human approval until separately validated. No specification silently raises
autonomy.

## Regional behavior

Global defaults are inherited by North America and the Caribbean, then by
country. Locale, currency, phone normalization, permitted channels, quiet
hours, tax/terms review, directories, and consent policy resolve from the active
pack. Unknown policy blocks sending, billing, or publishing where relevant.

## Entitlement and monetization

The website is the acquisition wedge; hosting is the first recurring
entitlement; measured needs may unlock later services. Presenter prices are
unvalidated research inputs, not Atlas prices. Atlas pricing requires regional
research, cost-to-serve, terms/tax review, and willingness-to-pay evidence.

## Evidence

Primary evidence is `video-qy0l1t7x6le` and its records in
`docs/control/RESEARCH_LEDGER.yaml`. The affiliate/training conflict is recorded
as `video-qy0l1t7x6le-affiliate-conflict`; every commercial claim is interpreted
accordingly.

## Analytics

Measure time-to-preview, fact-verification rate, QA failures, approval latency,
demo-to-reply, reply-to-meeting, meeting-to-hosting, churn, support load,
service attach rate, outcome attribution, complaints, suppressions, and cost per
stage. Segment by region, vertical, channel, template, and offer version.

## Errors and recovery

Fail closed on missing evidence, unresolved region, stale source, absent consent,
approval mismatch, provider failure, or deployment fingerprint mismatch. Retain
retryable jobs, idempotency keys, prior versions, rollback targets, and operator
resolution notes.

## Security and privacy

Minimize public and contact data, retain provenance and lawful-use review, encrypt
secrets outside docs, redact logs, enforce retention/deletion, scan generated
content, and audit all privileged/provider actions. Public availability is not
permission to republish assets or contact a person.

## MVP exclusions

No vendor parity, autonomous cold outreach, ranking/lead guarantees, undisclosed
affiliate behavior, unsupervised review replies, ad spend, mobile app,
marketplace, memberships, agent studio, or globally uniform legal/pricing policy.

## Acceptance tests

- Every candidate and executable capability resolves to an existing owner spec.
- Every cited evidence ID resolves; every observed label maps in the crosswalk.
- Region inheritance is deterministic and unknown policy fails closed.
- P2B can produce an approved sourced demo within the under-30-minute target.
- P2C cannot send or publish without required approval and suppression checks.
- Metrics distinguish presenter-reported hypotheses from Atlas-validated results.

## Progressive integration

- **build now:** owned governance, memory, descriptors, QA, approvals, audit,
  prospect/demo state, and analytics.
- **integrate now:** replaceable directory, preview hosting, and supervised
  messaging adapters needed for the pilot.
- **build later:** validated recurring-service workflows and richer agents.
- **exclude pending evidence:** unverified AI-agent sub-tabs, legal conclusions,
  prices, guarantees, and low-evidence marketplace/mobile/membership features.

## Specification index

| Boundary | Owner |
|---|---|
| Region inheritance and specialization | `docs/specs/p2/regional-packs.md` |
| Memory, mission control, playbooks, logs | `docs/specs/p2/intelligence-foundation.md` |
| Research-to-approved-site factory | `docs/specs/p2/website-factory.md` |
| Prospecting-to-hosting pilot | `docs/specs/p2/revenue-pilot.md` |
| Recurring service expansion | `docs/specs/p2/upsell-capabilities.md` |
| Presenter method | `docs/specs/p2/presenter-workflow-playbook.md` |
| Observed-menu reference | `docs/specs/p2/menu-crosswalk.md` |

## Durable capability traceability

“Owner specification” is the authoritative `capabilityMetadata.specification` or
candidate-registry value. A target/delta spec guides future reconciliation but
does not replace ownership without an approved registry migration.

| Capability/candidate | Kind | Phase | Lifecycle decision | Owner specification | P2 target/delta specification |
|---|---|---|---|---|---|
| `memory.answer` | executable | P1 | build now/core | `briefs/P1-CODEX-services.md` | `docs/specs/p2/intelligence-foundation.md` |
| `memory.ingest` | executable | P1 | build now/core | `briefs/P1-CODEX-services.md` | `docs/specs/p2/intelligence-foundation.md` |
| `memory.distill` | executable | P1 | build now/core | `briefs/P1-CODEX-services.md` | `docs/specs/p2/intelligence-foundation.md` |
| `memory.adjudicate` | executable | P1 | build now/core | `briefs/P1-CODEX-services.md` | `docs/specs/p2/intelligence-foundation.md` |
| `runs.execute` | executable | P1 | build now/core | `briefs/P1-CODEX-services.md` | `docs/specs/p2/intelligence-foundation.md` |
| `playbooks.author` | executable | P2A | build now | `docs/specs/p2/intelligence-foundation.md` | — |
| `approvals.list` | executable | P1 | build now/core | `briefs/P1-CODEX-services.md` | `docs/specs/p2/intelligence-foundation.md` |
| `approvals.decide` | executable | P1 | build now/core | `briefs/P1-CODEX-services.md` | `docs/specs/p2/intelligence-foundation.md` |
| `status.mission_control` | executable | P1 | build now/core | `briefs/P1-CODEX-services.md` | `docs/specs/p2/intelligence-foundation.md` |
| `bench.run` | executable | P1 | build now/core | `briefs/P1-CODEX-services.md` | `docs/specs/p2/intelligence-foundation.md` |
| `factory.build_site` | executable | P2B | build now | `docs/specs/p2/website-factory.md` | — |
| `factory.deploy_site` | executable | P2B | build now | `docs/specs/p2/website-factory.md` | — |
| `events.site` | executable | P2B | build now | `docs/specs/p2/website-factory.md` | — |
| `leads.find` | executable | P2C | integrate now | `docs/specs/p2/revenue-pilot.md` | — |
| `outreach.send` | executable | P2C | integrate now/shadow | `docs/specs/p2/revenue-pilot.md` | — |
| `platform.dashboard` | candidate | P2A | build now | `docs/specs/p2/intelligence-foundation.md` | — |
| `agents.logs` | candidate | P2A | build now | `docs/specs/p2/intelligence-foundation.md` | — |
| `conversations.inbox` | candidate | P2B | build now | `docs/specs/p2/website-factory.md` | — |
| `factory.template_library` | candidate | P2B | build now | `docs/specs/p2/website-factory.md` | — |
| `factory.assisted_editor` | candidate | P2B | build now | `docs/specs/p2/website-factory.md` | — |
| `automation.sequence` | candidate | P2C | build now | `docs/specs/p2/revenue-pilot.md` | — |
| `prospecting.workspace` | candidate | P2C | build now | `docs/specs/p2/revenue-pilot.md` | — |
| `billing.manage` | candidate | P3 | integrate now after pilot approval | `docs/specs/p2/revenue-pilot.md` | — |
| `calendar.manage` | candidate | P3 | integrate later | `docs/specs/p2/upsell-capabilities.md` | — |
| `contacts.manage` | candidate | P3 | build later | `docs/specs/p2/upsell-capabilities.md` | — |
| `opportunities.manage` | candidate | P3 | build later | `docs/specs/p2/upsell-capabilities.md` | — |
| `agents.studio` | candidate | P3 | build later | `docs/specs/p2/upsell-capabilities.md` | — |
| `voice.agent` | candidate | P3 | integrate later | `docs/specs/p2/upsell-capabilities.md` | — |
| `conversations.agent` | candidate | P3 | build later | `docs/specs/p2/upsell-capabilities.md` | — |
| `knowledge.base` | candidate | P3 | build later | `docs/specs/p2/upsell-capabilities.md` | — |
| `agents.templates` | candidate | P3 | exclude pending evidence | `docs/specs/p2/upsell-capabilities.md` | — |
| `content.generate` | candidate | P3 | build later | `docs/specs/p2/upsell-capabilities.md` | — |
| `marketing.email` | candidate | P3 | integrate later | `docs/specs/p2/upsell-capabilities.md` | — |
| `marketing.social` | candidate | P3 | integrate later | `docs/specs/p2/upsell-capabilities.md` | — |
| `marketing.snippets` | candidate | P3 | build later | `docs/specs/p2/upsell-capabilities.md` | — |
| `marketing.countdown` | candidate | P3 | exclude pending evidence | `docs/specs/p2/upsell-capabilities.md` | — |
| `marketing.trigger_links` | candidate | P3 | build later | `docs/specs/p2/upsell-capabilities.md` | — |
| `reputation.manage` | candidate | P3 | integrate later | `docs/specs/p2/upsell-capabilities.md` | — |
| `seo.audit` | candidate | P3 | build later | `docs/specs/p2/upsell-capabilities.md` | — |
| `aeo.audit` | candidate | P3 | build later | `docs/specs/p2/upsell-capabilities.md` | — |
| `ads.manage` | candidate | P3 | integrate later | `docs/specs/p2/upsell-capabilities.md` | — |
| `brand.manage` | candidate | P3 | build later | `docs/specs/p2/upsell-capabilities.md` | — |
| `affiliates.manage` | candidate | P3 | exclude pending evidence | `docs/specs/p2/upsell-capabilities.md` | — |
| `memberships.manage` | candidate | P3 | exclude pending evidence | `docs/specs/p2/upsell-capabilities.md` | — |
| `media.storage` | candidate | P3 | integrate later | `docs/specs/p2/upsell-capabilities.md` | — |
| `reporting.analytics` | candidate | P3 | build later | `docs/specs/p2/upsell-capabilities.md` | — |
| `marketplace.apps` | candidate | P3 | exclude pending evidence | `docs/specs/p2/upsell-capabilities.md` | — |
| `mobile.app` | candidate | P3 | exclude pending evidence | `docs/specs/p2/upsell-capabilities.md` | — |
