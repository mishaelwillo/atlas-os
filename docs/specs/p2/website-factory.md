# Website Factory

## Purpose

Turn an approved public business profile URL and operator brief into a sourced,
editable, accessible, approved preview and then a governed live site. Target:
approved demo in under 30 minutes, without invented facts or unlicensed assets.

## Users

Operator/researcher, site designer, business-owner approver, publisher, platform
administrator, support analyst, and a model acting only inside declared stages.

## Inputs and outputs

Inputs: tenant, region pack, profile/directory URL, explicit source URLs, vertical,
template/style choice, owner-supplied assets, approved claims, domain, integrations,
and entitlement. Outputs: research dossier, source facts, descriptor/version,
render, QA report, preview URL, owner/operator approvals, deployment/fingerprint,
event configuration, and portable export.

## UI and menu

Website Factory:

1. Research — sources, extracted facts, rights status, conflicts.
2. Descriptor — pages, sections, copy, calls-to-action, structured data.
3. Templates — declarative vertical/region variants.
4. Generate — staged run with logs.
5. Verify — facts, links, accessibility, responsive, privacy, performance.
6. Preview — shareable expiring demo and feedback.
7. Integrations — CRM/conversation/event adapters.
8. Approval — operator and owner decisions.
9. Publish — domain, deployment, rollback, monitoring.

Presenter labels `Details`, `Preview`, `Connect to CRM`, `Dismiss`, `Connect`,
`Exploring styles`, `Starting live preview`, `Getting ready`, and `Publish` are
source references; Atlas uses the explicit stages above.

## Workflow and states

`intake → researching → facts_pending_review → descriptor_draft → template_selected
→ generating → generated → qa_failed|verification_review → preview_ready
→ operator_approved → owner_approved → publish_queued → live → superseded|rolled_back`.

Research adapters capture URL, timestamp, quotation-free normalized fact, asset
rights status, confidence, and hash. Conflicts block generation of the affected
claim. Generation is deterministic from descriptor + template + tokens. Preview
is isolated and expiring. Publishing requires approvals, entitlement, domain
proof, policy checks, and an immutable version.

## Data entities

- `business_profile(id, tenant_id, region_id, source_url, fetched_at)`
- `source_document(id, url, type, hash, license_or_rights, retrieved_at)`
- `source_fact(id, subject, predicate, value, source_id, confidence, status)`
- `site_descriptor(id, business_id, schema_version, locale, status)`
- `descriptor_section(id, descriptor_id, type, content, fact_refs, asset_refs)`
- `template(id, version, vertical, regions, tokens, accessibility_contract)`
- `site_version(id, descriptor_hash, template_version, build_hash, status)`
- `qa_result(id, site_version_id, check, severity, evidence, resolution)`
- `preview(id, site_version_id, url, expires_at, access_policy)`
- `site_approval(id, version, actor, role, decision, notes, decided_at)`
- `deployment(id, version, environment, domain, commit/build/fingerprint, status)`
- `site_integration(id, adapter, scopes, status)` and `site_event`.

## APIs, events, and integrations

`factory.build_site` accepts profile URL/template/style and returns site/preview;
its build implementation expands to dossier and descriptor references.
`factory.deploy_site` promotes an immutable approved version and remains
approval-required/shadow. `events.site` ingests schema-validated form/chat/call
events. Candidate `factory.template_library`, `factory.assisted_editor`, and
`conversations.inbox` are owned here.

Planned APIs: research dossier CRUD, descriptor versions/diff, template list,
QA execution, preview feedback, domain verification, rollback, and export.
Events: `research.completed`, `fact.conflicted`, `descriptor.versioned`,
`site.generated`, `qa.failed|passed`, `preview.ready`, `site.approved`,
`site.published|rolled_back`, `site.form_submitted`. Directory, browser,
image/storage, DNS, hosting, analytics, forms, chat, and CRM are adapters.

## Permissions, approvals, and autonomy

Researchers may draft facts; operators verify. Models cannot mark facts verified,
approve, acquire domains, publish, or enable contact integrations. Operator
approval is required before external demo sharing; business-owner approval is
required before production content/domain activation. Publish/rollback are
privileged and audited. Preview generation may be threshold-autonomous only after
input and rights checks.

## Regional behavior

Descriptor stores region/locale/currency. Packs drive spelling, address/phone,
currency display, directory/review links, preferred contact channels, privacy
copy placeholder, and structured-data locality. Unknown terms/tax/consent policy
blocks production, not merely outreach. Default MVP languages are the committed
English locales; Canadian French requires approved copy, not machine assumption.

## Entitlement and monetization

`website-factory` permits internal/demo generation; `website-hosting` permits
governed live hosting and events. Free-site or hosting-only is an offer
experiment, not a default contract. Ownership, export, support, edits, renewal,
taxes, suspension, cancellation, domain, and data portability must be approved.
No presenter-reported number is used automatically.

## Evidence

- `video-qy0l1t7x6le-website-wedge`
- `video-qy0l1t7x6le-template-library`
- `video-qy0l1t7x6le-ai-assisted-editor`
- `video-qy0l1t7x6le-gbp-site-prompt`
- `video-qy0l1t7x6le-generation-stages`
- `video-qy0l1t7x6le-prebuild-demos`
- `video-qy0l1t7x6le-unified-conversations`
- `video-qy0l1t7x6le-follow-up-automation`
- `video-qy0l1t7x6le-free-hosting-offer`

The video does not establish content rights, factual consistency, owner approval,
conversion lift, or hosting economics; Atlas adds those controls.

## Analytics

Time per stage/under-30-minute success, sources/facts/conflicts, manual corrections,
generation retries, QA failures by rule, accessibility/performance, preview views,
feedback, approval latency/rejection reason, publish success/rollback, conversion,
support/edit time, event delivery, uptime, and cost per demo/live site.

## Errors and recovery

Adapter timeout creates a resumable research job; stale sources require refresh;
fact conflicts isolate affected fields; invalid descriptor never renders; build
failures retain logs; QA blocks preview/share by severity; preview expiry supports
renewal; publish uses idempotency and fingerprint verification; failed health
checks roll back to last good version. Integration failure cannot take down site.

## Security and privacy

Allowlisted fetch protocols, SSRF defenses, malware scanning, image-rights
evidence, HTML sanitization, CSP, secure forms, spam/rate limits, encrypted
provider credentials, least-scope OAuth, tenant/domain isolation, consent capture,
PII minimization, retention/deletion, audit, and private-by-default previews.

## MVP exclusions

No arbitrary drag-and-drop parity, ecommerce, memberships, unsourced testimonials,
copied logos/photos without rights, autonomous domain purchase, multilingual
generation beyond approved copy, guaranteed SEO, autonomous CRM campaigns, or
production publish without both required approvals.

## Acceptance tests

- A supported profile creates dossier → descriptor → accessible preview inside
  30 minutes in the benchmark, with every displayed business fact source-linked.
- Missing/contradictory fact and unknown asset rights block the affected output.
- Descriptor/template versions reproduce the same render and are exportable.
- Required accessibility, responsive, link, structured-data, privacy, security,
  and performance checks pass before approval.
- Production publish fails without entitlement, region policy, domain proof,
  immutable version, operator approval, and owner approval.
- Deployment records fingerprint and supports verified rollback.
- `events.site` rejects invalid tenant/site/schema and deduplicates retries.

## Progressive integration

- **build now:** dossier/facts, descriptor, templates, generation state machine,
  QA, preview, approvals, deployment record, rollback, events, analytics.
- **integrate now:** approved directory/browser, preview/production hosting, DNS,
  storage, forms, and optional conversation adapter.
- **build later:** richer editor, vertical packs, localization workflow, experiment
  engine, and validated customer engagement.
- **exclude pending evidence:** copied vendor editor parity, autonomous publishing,
  unsourced content, unlicensed media, and implied CRM/SEO outcomes.

## Feature specifications

### Research dossier

Purpose: create a minimal sourced truth set. UI shows field/source/confidence/rights
and operator verdict. Input is approved URLs; output is verified facts and gaps.
Errors are per-source and resumable. Acceptance: zero generated business fact
without a source or explicit owner entry.

### Descriptor and assisted editor

Purpose: separate intent/content from rendering so the feature is graftable into
another app. JSON-schema descriptor contains navigation, sections, components,
tokens, fact/asset refs, locale, CTA/event bindings, SEO metadata, and policy
flags. Every edit versions and diffs. Acceptance: renderer never needs raw model
output or provider-specific fields.

### Template library and renderer

Purpose: reusable declarative layouts by vertical/region. Templates declare
supported component contracts, responsive/accessibility budgets, tokens, and
version. Acceptance: invalid component/region combinations fail before build.

### Verification, preview, and publishing

Purpose: make quality and external effects explicit. Preview uses immutable build,
access/expiry, feedback, and noindex. Publish promotes exactly that hash after
approval. Acceptance: public fingerprint equals approved build; rollback proves
previous fingerprint healthy.

### Conversations and events

Purpose: normalize form/chat/call events without coupling the site to a provider.
Event envelope carries tenant/site/channel/schema/consent/idempotency. Output is
an acknowledged conversation/event reference. Acceptance: adapter outage queues
delivery while the website remains available.
