# Revenue Pilot

## Purpose

Validate one complete, supervised path from regional niche research through
qualified prospect, approved demo outreach, explicit hosting offer, activation,
delivery, and measured learning. Exit: one real hosting-paying customer, without
automating legal assumptions or cold outreach.

## Users

Growth operator, researcher, site operator, outreach approver/sender, business
owner, billing administrator, support owner, policy reviewer, and analyst.

## Inputs and outputs

Inputs: approved region/vertical hypothesis, directory source, qualification
rules, sourced business facts/contact provenance, 5–10 approved demos, channel
policy, suppression/consent state, offer/terms version, and human decisions.
Outputs: market brief, prospect dossier/score, demo queue, approved message,
touch/outcome history, meeting/decision, signed terms, payment-provider reference,
hosting entitlement, onboarding record, service baseline, and experiment result.

## UI and menu

Prospecting → Markets, Prospects, Qualification, Demo Queue. Outreach → Drafts,
Approvals, Sequence, Conversations, Suppression. Revenue Operations → Offers,
Meetings, Decisions, Hosting Activation, Billing Status. Analytics → Funnel,
cohorts, complaints, cost, support, churn. Each row displays region, source,
policy, evidence, owner, next action, and expiry.

## Workflow and states

1. Market: `hypothesis → researched → approved|rejected`.
2. Prospect: `sourced → eligibility_review → qualified|disqualified|expired`.
3. Demo: `queued (cap 10) → building → qa → approved → shareable|expired`.
4. Outreach: `draft → policy_check → approval_required → approved → scheduled
   → sent → delivered|failed → replied|no_reply|suppressed`.
5. Deal: `interested → discovery → offer_review → accepted|declined`.
6. Hosting: `terms_approved → payment_pending → entitlement_active → onboarded
   → active → past_due|cancelled`.
7. Learn: `baseline → observation_window → reviewed → decision`.

No step assumes the next. The presenter sequence—email, then SMS, social DM, and
phone—may be drafted, but each touch is separately eligible, capped, approved,
audited, and stopped on reply/opt-out/complaint.

## Data entities

`market_hypothesis`, `market_research`, `prospect`, `prospect_source`,
`qualification_assessment`, `contact_point`, `consent_evidence`,
`suppression_entry`, `demo_queue_item`, `outreach_sequence/version`,
`outreach_touch`, `approval`, `conversation`, `offer/version`,
`commercial_term`, `deal_decision`, `payment_customer_reference`,
`hosting_entitlement`, `onboarding`, `service_baseline`, `experiment_metric`,
and `audit_event`.

## APIs, events, and integrations

`leads.find` uses an approved directory adapter and remains manual/integration.
`outreach.send` remains shadow, approval-required, and adapter-backed.
`automation.sequence` plans state but cannot bypass per-touch checks.
`prospecting.workspace` owns review state. `billing.manage` integrates a payment
provider only after accepted terms and approval.

Planned APIs cover market/qualification CRUD, demo queue, outreach preview/check/
approve/send/stop, suppression, offer decision, hosting activation/cancellation,
and funnel export. Events include `prospect.sourced|qualified`,
`demo.approved`, `outreach.approval_requested|sent|replied|suppressed`,
`offer.accepted`, `payment.confirmed`, `hosting.activated|cancelled`,
`experiment.reviewed`. Directory, messaging, calendar, telephony, social,
payments, CRM, and hosting remain replaceable adapters.

## Permissions, approvals, and autonomy

Research may suggest candidates; an operator qualifies. All external demo sharing
and outbound touches require a named human approval in the pilot; approval is
specific to recipient, channel, content hash, send window, and offer version.
Models cannot scrape around provider terms, infer consent, send, call, accept
terms, charge, activate billing, or increase caps. Replies, opt-outs, complaints,
hard bounces, invalid policy, or expired approval stop the sequence.

## Regional behavior

Select region before niche. Resolve currency, locale, phone, channel availability,
quiet hours and required policy review from the pack. North American SMS and
Caribbean WhatsApp preference are availability hints, not permission. Contact
and directory use require documented provider/policy review. Unknown rules block.
Offers and terms are versioned per country/currency; no silent USD assumption.

## Entitlement and monetization

The presenter proposes a free/prebuilt site with hosting-only payment. Atlas tests
that as one transparent offer version. Before activation disclose site/domain
ownership, hosting/security scope, support/edit boundary, data portability,
renewal, taxes, cancellation/refund, suspension, and migration. `revenue-pilot`
permits supervised prospecting/outreach; `website-hosting` activates only after
accepted terms and confirmed provider payment.

Presenter-reported USD figures—100/119 monthly hosting, 2,000 website reference,
50/100 hourly edits, and later service prices—are unvalidated research, not Atlas
price policy. The AEO caption-rendered 9.97 is especially unresolved.

## Evidence

- `video-qy0l1t7x6le-google-maps-prospecting`
- `video-qy0l1t7x6le-prebuild-demos`
- `video-qy0l1t7x6le-multichannel-outreach`
- `video-qy0l1t7x6le-follow-up-automation`
- `video-qy0l1t7x6le-free-hosting-offer`
- `video-qy0l1t7x6le-presenter-pricing`
- `video-qy0l1t7x6le-affiliate-conflict`

The presenter supplies no data licensing, consent, regional compliance, cost
model, controlled conversion, customer sample, tax analysis, or independent
price validation. Platform/training affiliate incentives may shape the pitch.

## Analytics

Markets screened/approved; prospects sourced/qualified with reasons; source age;
demo time/cost/QA/expiry; approvals/rejections; delivery/reply/positive reply/
meeting/offer/hosting conversion; channel sequence contribution (not assumed
causation); opt-out/complaint/bounce; days to activation; gross revenue, provider
cost, labor/support, gross margin; churn/cancellation; satisfaction; attach-rate;
and cohort results by region/vertical/offer/template.

## Errors and recovery

Provider/eligibility uncertainty sends to review; duplicate business merges with
provenance; stale demos expire; policy or contact changes invalidate approval;
send uses idempotency and status reconciliation; delivery failure does not trigger
another channel automatically; payment webhooks reconcile without storing card
data; failed activation rolls back entitlement; cancellation preserves export
and terms history.

## Security and privacy

Minimize lead/contact data, respect provider terms, record source and purpose,
encrypt provider references, isolate tenants, redact communications from broad
logs, enforce retention/deletion/suppression, authenticate webhooks, rate-limit
and cap sends, audit exports and approvals, and prohibit purchased/unknown lists
in the pilot.

## MVP exclusions

No autonomous cold outreach, bulk lists, auto-dialing, bought contacts, implicit
consent, unapproved cross-channel escalation, conversion guarantees, hidden terms,
stored payment credentials, automatic upsells, or more than one tightly bounded
regional/vertical cohort at a time.

## Acceptance tests

- A market brief records competitor/customer/problem/channel/price hypotheses and
  evidence quality before prospecting.
- Each qualified prospect has active-profile evidence, no/weak-site assessment,
  source provenance, contact-policy decision, region, owner, and expiry.
- Demo queue enforces 5–10 cap and QA/approval/expiry.
- `outreach.send` cannot send without valid policy, suppression check, specific
  human approval, cap, window, and content hash; it stops on reply/opt-out.
- Hosting cannot activate before approved terms and confirmed payment; cancellation
  disables renewal while preserving export/history.
- One paying customer and complete cost/support/outcome record satisfy pilot exit;
  zero customers is recorded as evidence, not concealed.

## Progressive integration

- **build now:** market/prospect qualification, demo queue, approval/suppression,
  sequence state, offers/terms, hosting activation state, funnel analytics.
- **integrate now:** approved directory, email/SMS/WhatsApp/phone/social drafts,
  calendar, payments, and hosting—with external effects human-triggered.
- **build later:** validated automation, CRM pipeline, renewals, experiments, and
  region-specific offers after pilot evidence.
- **exclude pending evidence:** autonomous outreach, presenter prices as defaults,
  legal conclusions, aggressive frequency, and guaranteed economics.

## Qualification rubric

Required: target region/vertical; current active profile; no website link or a
documented weak-site problem; verifiable identity/location; useful public facts;
contact source and policy review; no suppression; plausible benefit; demo effort
inside cap. Score fit, urgency, evidence, contactability, demo effort, and risk.
Disqualify duplicates, closed/uncertain businesses, insufficient rights/facts,
policy uncertainty that cannot be resolved, or deceptive-demo risk.

## Market research brief

Record region, niche, job-to-be-done, directory coverage, sample size, competitor
sites/offers, common weak-site patterns, customer language, channel availability,
provider/terms constraints, local currency, cost-to-serve, price hypotheses,
interview evidence, success/failure thresholds, and review date. Research never
authorizes contact.
