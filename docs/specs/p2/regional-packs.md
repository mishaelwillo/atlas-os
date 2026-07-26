# Regional Packs

## Purpose

Resolve global product behavior into explicit regional policy without forking the
product. Initial packs cover global, North America, United States, Canada,
Caribbean, Saint Lucia, Jamaica, and Trinidad and Tobago.

## Users

Platform administrators author packs; operators select a market; builders consume
resolved settings; compliance/finance reviewers approve channel, terms, tax, and
currency policy; analysts compare regional outcomes.

## Inputs and outputs

Input: region ID, tenant overrides allowed by schema, locale, business location,
and timestamp. Output: immutable resolved pack/version with countries, languages,
currencies, phone regions, preferred channels, directories, review platforms,
SEO depth, and outreach policy plus unresolved-policy blockers.

## UI and menu

Settings → Regions shows inheritance, effective values, review status, last
verified date, and impacted tenants. Every Factory, Prospecting, Outreach, and
Growth screen displays the active region/locale/currency and blocks ambiguous
country selection.

## Workflow and states

`draft → schema-valid → policy-review → approved → active → superseded`.
Resolution walks `global → group → country → permitted tenant override`; cycles,
unknown parents, duplicate country ownership, or missing required policy fail.

## Data entities

`region_pack`, `region_pack_version`, `region_resolution`, `policy_review`,
`tenant_region_binding`, `locale_bundle`, `channel_policy`, and `currency_policy`.

## APIs, events, and integrations

`GET /v1/regions`, `POST /v1/regions/resolve`, and governed admin versioning are
planned registry additions. Emit `region.resolved`, `region.policy_blocked`, and
`region.pack_superseded`. Address/phone, messaging, payment, directory, and
hosting adapters receive the resolved pack, never infer it independently.

## Permissions, approvals, and autonomy

Reads are tenant-scoped. Only platform admins propose packs; activation requires
policy-owner approval. No model may invent legal, tax, consent, quiet-hour, or
currency rules. Unknown policy keeps outreach and billing in shadow/manual mode.

## Regional behavior

Global defaults prefer email/phone and shadow outreach. North America adds SMS;
Caribbean prefers WhatsApp/email/phone. Country packs define locale and currency.
These are product defaults, not legal conclusions: every pack currently requires
policy review before outreach. Currency display never implies tax-inclusive terms.

## Entitlement and monetization

Pack resolution is platform entitlement. Country-specific channels/provider
costs may affect future offers only after finance validation; pricing is stored by
offer version and currency, never converted silently.

## Evidence

Product doctrine establishes global plus initial North American/Caribbean focus.
Observed channel inventory comes from
`video-qy0l1t7x6le-unified-conversations`; outreach risk from
`video-qy0l1t7x6le-multichannel-outreach` and
`video-qy0l1t7x6le-google-maps-prospecting`.

## Analytics

Resolution failures, pack age, policy-review latency, channel availability,
contactability, approval/rejection, complaints, suppressions, conversions, churn,
provider cost, and support load by pack/version.

## Errors and recovery

Return structured blockers for unknown region, invalid inheritance, missing
policy, unsupported currency/channel, or stale review. Preserve the last approved
pack for rollback; never fall back to a broader pack for a safety-critical field.

## Security and privacy

Packs contain policy, not secrets. Tenant bindings are isolated; location is
minimized; country inference is shown for confirmation. Log the resolved version
used for each publish, send, and billing action.

## MVP exclusions

No global tax engine, automated legal advice, automatic currency conversion,
translation generation, or expansion beyond approved initial packs.

## Acceptance tests

- Resolution is deterministic and cycle-free for all committed packs.
- United States inherits USD/en-US and North American channels.
- Saint Lucia inherits Caribbean preferences and XCD/en-LC.
- Missing outreach policy blocks a send; unknown currency blocks billing.
- Every action records region and pack version.

## Progressive integration

- **build now:** schema, inheritance, resolver, binding, audit, policy blockers.
- **integrate now:** phone/address normalization and provider capability lookup.
- **build later:** approved localization, translation, and regional offer lab.
- **exclude pending evidence:** inferred law/tax rules and unsupported markets.
