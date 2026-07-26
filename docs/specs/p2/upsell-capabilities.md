# P3 Upsell Capabilities

## Purpose

Stage recurring services behind verified customer need, explicit scope,
measurable baselines, regional policy, entitlement, and human approval. The order
is a diagnostic sequence, not a mandatory bundle: reputation → SEO/AEO → social
→ email → ads, with supporting engagement/agent/platform capabilities.

## Users

Account operator, specialist, content/review approver, business owner, platform
administrator, finance/policy reviewer, and analyst.

## Inputs and outputs

Inputs: active customer/hosting entitlement, discovery notes, baseline audit,
regional policy, provider access, owner-approved assets/claims, consent/list
provenance, budget, service scope, and success metric. Outputs: assessment,
recommendation, proposal/version, approvals, work plan, provider actions,
evidence report, renewal/cancel decision, and capability learning.

## UI and menu

Growth → Assessments, Reputation, SEO/AEO, Social, Email, Ads, Brand, Content,
Attribution. Customer Engagement → Inbox, Contacts, Calendar. Revenue Operations
→ Opportunities/Billing. Agents and Platform surfaces remain entitlement-gated.
Only enabled, validated services appear as executable actions.

## Workflow and states

Per service: `discovered → baseline → candidate → scope_review → offered
→ accepted → access_pending → active → measuring → renew|revise|cancel`.
Per action: `draft → policy/quality check → owner approval → scheduled/executed
→ reconciled → measured`. Missing baseline, access, consent, budget, or approval
returns to review; no service is activated merely because a menu exists.

## Data entities

`service_assessment`, `baseline_metric`, `recommendation`, `service_offer/version`,
`service_entitlement`, `provider_connection`, `campaign/content/version`,
`approval`, `publication/send/ad_action`, `budget_cap`, `attribution_event`,
`outcome_measurement`, `renewal_decision`, and `audit_event`.

## APIs, events, and integrations

Candidates: `reputation.manage`, `seo.audit`, `aeo.audit`, `marketing.social`,
`marketing.email`, `ads.manage`, `brand.manage`, `content.generate`,
`marketing.snippets`, `marketing.trigger_links`, `calendar.manage`,
`contacts.manage`, `opportunities.manage`, `voice.agent`,
`conversations.agent`, `knowledge.base`, `agents.studio`, `agents.logs`,
`media.storage`, and `reporting.analytics`.

Adapters cover review platforms, search/analytics, social, email, ads, calendar,
voice, storage, and payments. Events include `assessment.completed`,
`service.accepted`, `content.approved|published`, `campaign.sent`,
`review.detected|response_approved`, `audit.completed`, `budget.blocked`,
`outcome.measured`, and `service.cancelled`.

## Permissions, approvals, and autonomy

Provider connections use least scopes and owner authorization. Review responses,
content publishing, email sending, voice, knowledge publication, campaign launch,
and ad spend require human approval initially. Ads enforce per-period caps and
kill switch. Suppression/consent applies to email. Models draft/analyze only;
they cannot promise outcomes, impersonate customers, alter budgets, or escalate
autonomy.

## Regional behavior

Resolve locale, currency, channels, review/search platforms, audience, claims,
quiet hours, consent, and terms from region/tenant policy. Content is reviewed by
a locale-capable human. Provider availability varies. Unknown policy/access
blocks activation; global copy and USD pricing do not silently propagate.

## Entitlement and monetization

Each service has a separately accepted scope, entitlement, cadence, provider
cost, labor budget, success measure, renewal, and cancellation. Presenter reports
SEO/reputation around USD 2,000, social USD 300–2,500 monthly, email USD 1,000
monthly, and a caption-rendered AEO USD 9.97 monthly; all are unvalidated,
affiliate-influenced research inputs and never defaults.

## Evidence

Observed/presenter records:
`video-qy0l1t7x6le-upsell-reputation`,
`video-qy0l1t7x6le-upsell-seo`,
`video-qy0l1t7x6le-upsell-aeo`,
`video-qy0l1t7x6le-upsell-social`,
`video-qy0l1t7x6le-upsell-email`,
`video-qy0l1t7x6le-upsell-ads`,
`video-qy0l1t7x6le-marketing-navigation`,
`video-qy0l1t7x6le-ai-agent-tabs`,
`video-qy0l1t7x6le-presenter-pricing`, and
`video-qy0l1t7x6le-affiliate-conflict`.
Offer effectiveness, deliverables, causal results, and prices are not validated.

## Analytics

Assessment-to-offer/acceptance, activation time, provider/action errors, approval
latency, workload and gross margin, service-specific baselines/outcomes, attach,
renewal/churn, complaints/suppressions, ad budget and conversions, content/review
quality, attribution confidence, and customer-reported value.

## Errors and recovery

Expired access pauses work; failed provider actions reconcile before retry;
duplicate sends/posts are prevented by idempotency; policy/quality failures return
to draft; budget overrun hard-stops ads; incorrect content supports takedown and
version rollback; uncertain attribution is labeled; cancellation revokes tokens
and future schedules while retaining required audit/export.

## Security and privacy

OAuth/token vaulting, least scope, tenant isolation, approval/audit, consent and
suppression, PII minimization, asset rights, claim substantiation, content
sanitization, signed webhooks, retention/deletion, spend caps, role separation,
and provider offboarding are mandatory.

## MVP exclusions

No outcome/ranking guarantees, review manipulation, undisclosed synthetic
endorsement, purchased email lists, autonomous publishing/sending/spend, opaque
attribution, vendor agent parity, memberships, marketplace, mobile app, affiliate
program, or countdown scarcity without validated truthful-offer rules.

## Acceptance tests

- No service activates without baseline, scope, entitlement, owner approval,
  provider access, region policy, and measurable success criteria.
- Reputation responses remain draft until approval; audit preserves source.
- SEO/AEO reports separate observed findings from uncertain recommendations.
- Email proves list provenance, consent basis, suppression, preview, and approval.
- Social proves asset rights, locale review, channel preview, and reconciliation.
- Ads reject missing budget/conversion measurement and hard-stop at cap.
- Renewal view includes measured outcome, cost, margin, incidents, and owner decision.

## Progressive integration

- **build now:** assessment/scope/entitlement/approval/outcome framework and
  transparent SEO/AEO baseline audits when prioritized.
- **integrate now:** none by default; provider connection starts only after a
  validated customer need and approved experiment.
- **build later:** reputation, social, email, ads, engagement, reporting, brand,
  content, and agent workflows in evidence-led increments.
- **exclude pending evidence:** agent templates/sub-tabs, countdowns, affiliates,
  memberships, marketplace, mobile app, prices, guarantees, and vendor parity.

## Feature specifications

### Reputation

Purpose: monitor reviews and assist responses. Input is authorized platform data
and brand policy; output is alert, drafted response, approval, publication status,
and response-time/sentiment baseline. Integrate provider; build governed review
queue. Never incentivize or suppress reviews deceptively.

### SEO and AEO

Purpose: measure technical/local search and observable answer-engine visibility.
Input is site, business entities, search/analytics access, and target region;
output is reproducible audit, prioritized fixes, confidence, and remeasurement.
Build audit first. No ranking or citation guarantee.

### Social

Purpose: approved regional content planning/publishing. Input is goals, calendar,
brand/assets/rights; output drafts, previews, approvals, provider receipts, and
engagement. Integrate provider later; Atlas owns plan/version/audit.

### Email

Purpose: consent-based lifecycle campaigns. Input is provenance-tagged contacts,
segment, content, sender/domain readiness; output preview, approval, send receipt,
delivery, opt-out, conversion. Integrate provider later; suppression is global
within tenant and cannot be overridden by automation.

### Ads

Purpose: approved, capped acquisition experiments. Input is audience/keywords,
creative rights, landing page, tracking, budget/currency; output plan, approval,
provider campaign refs, spend, conversions, and stop decision. No launch without
budget and conversion measurement.

### Supporting platform and agents

Contacts/opportunities/reporting are owned records built later; calendar, media,
voice and provider channels are replaceable integrations. Agent studio,
conversation agent, knowledge base and content generation use approved knowledge,
tool scopes, audit, escalation, and evaluations. Agent templates, memberships,
marketplace, mobile, affiliate manager, and countdowns remain research-only.
