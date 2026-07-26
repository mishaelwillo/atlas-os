# Observed Menu Crosswalk

This is a source-evidence crosswalk, not a request to clone GoHighLevel or any
vendor UI. Labels/casing below are preserved only where the validated research
ledger records them. Atlas placement follows Atlas product groups and entitlement.

## Main navigation

Evidence: `video-qy0l1t7x6le-dashboard-navigation` (observed, high confidence).

| Observed label | Atlas capability/candidate | Stage / phase | Decision | Owning spec | Proposed Atlas placement |
|---|---|---|---|---|---|
| `Ask AI` | `memory.answer` | core / P1 | build now | intelligence | Intelligence Bank → Ask |
| `Launchpad` | `playbooks.author` | candidate / P2A | build now | intelligence | Intelligence Bank → Playbooks |
| `Dashboard` | `platform.dashboard`, `status.mission_control` | observed/core / P2A/P1 | build now | intelligence | Mission Control |
| `Conversations` | `conversations.inbox` | candidate / P2B | build now | website factory | Customer Engagement → Inbox |
| `Calendars` | `calendar.manage` | deferred / P3 | integrate later | upsells | Customer Engagement → Calendar |
| `Contacts` | `contacts.manage` | deferred / P3 | build later | upsells | Customer Engagement → Contacts |
| `Opportunities` | `opportunities.manage` | deferred / P3 | build later | upsells | Revenue Operations → Opportunities |
| `Payments` | `billing.manage` | deferred / P3 | integrate after pilot approval | revenue pilot | Revenue Operations → Billing |
| `AI Studio` | `agents.studio` | deferred / P3 | build later | upsells | Agents → Studio |
| `AI Agents` | `agents.studio`, `agents.logs` | deferred/candidate / P3/P2A | build later / build now logs | upsells/intelligence | Agents / Governance |
| `Marketing` | growth candidates | observed/deferred / P3 | staged | upsells | Growth |
| `Automation` | `automation.sequence` | candidate / P2C | build now supervised | revenue pilot | Outreach → Sequences |
| `Sites` | `factory.build_site`, `factory.deploy_site` | candidate / P2B | build now | website factory | Website Factory |
| `Memberships` | `memberships.manage` | deferred / P3 | exclude pending evidence | upsells | Not enabled |
| `Media Storage` | `media.storage` | deferred / P3 | integrate later | upsells | Platform → Media |
| `Reputation` | `reputation.manage` | observed / P3 | integrate later | upsells | Growth → Reputation |
| `Reporting` | `reporting.analytics` | deferred / P3 | build later | upsells | Analytics |
| `App Marketplace` | `marketplace.apps` | deferred / P3 | exclude pending evidence | upsells | Not enabled |
| `Mobile App` | `mobile.app` | deferred / P3 | exclude pending evidence | upsells | Not enabled |
| `Settings` | platform/region/tenant settings | observed / P2A | build now owned controls | regional/intelligence | Settings |

## Marketing navigation

Evidence: `video-qy0l1t7x6le-marketing-navigation` (observed, high confidence).

| Observed label | Atlas candidate | Stage / phase | Decision | Owning spec | Proposed Atlas placement |
|---|---|---|---|---|---|
| `Social Planner` | `marketing.social` | observed / P3 | integrate later | upsells | Growth → Social |
| `Emails` | `marketing.email` | observed / P3 | integrate later | upsells | Growth → Email |
| `Snippets` | `marketing.snippets` | deferred / P3 | build later | upsells | Growth → Content |
| `Countdown Timers` | `marketing.countdown` | deferred / P3 | exclude pending evidence | upsells | Not enabled |
| `Trigger Links` | `marketing.trigger_links` | deferred / P3 | build later | upsells | Growth → Attribution |
| `Affiliate Manager` | `affiliates.manage` | deferred / P3 | exclude pending evidence | upsells | Not enabled |
| `Brand Boards` | `brand.manage` | deferred / P3 | build later | upsells | Growth → Brand |
| `Ad Manager` | `ads.manage` | deferred / P3 | integrate later | upsells | Growth → Ads |
| `Prospecting` | `prospecting.workspace`, `leads.find` | candidate / P2C | build/integrate now | revenue pilot | Prospecting |

## Conversation surfaces

Evidence: `video-qy0l1t7x6le-unified-conversations` (observed, high confidence).
Observed labels describe a demonstrated all-in-one surface; channel availability
is determined by regional policy and installed adapters.

| Observed label | Atlas mapping | Decision | Proposed placement |
|---|---|---|---|
| `Conversations` | `conversations.inbox` | build now | Customer Engagement → Inbox |
| `Manual Actions` | approval/manual work queue | build now | Governance → Actions |
| `Snippets` | `marketing.snippets` | build later | Growth → Content |
| `Trigger Links` | `marketing.trigger_links` | build later | Growth → Attribution |
| `Analytics` | `reporting.analytics` | build later | Analytics |
| `Settings` | channel/tenant settings | build now | Settings |
| `All-in-one chat` | normalized inbox view | build now | Customer Engagement → Inbox |
| `SMS / Email chat` | messaging adapters | integrate after policy approval | Inbox channel filter |
| `Live chat` | `events.site` + inbox | build now | Site integration / Inbox |
| `Facebook chat` | social messaging adapter | integrate later | Inbox channel filter |
| `Instagram chat` | social messaging adapter | integrate later | Inbox channel filter |
| `WhatsApp chat` | messaging adapter | integrate regionally | Inbox channel filter |
| `Voice AI` | `voice.agent` | integrate later | Agents → Voice |

## Website generation/editor controls

Evidence: `video-qy0l1t7x6le-generation-stages` (observed, high confidence).
These map to an explicit Atlas state machine, not identical UI.

| Observed label | Atlas capability/state | Decision | Owning spec | Proposed placement |
|---|---|---|---|---|
| `Details` | `factory.assisted_editor` descriptor | build now | website factory | Factory → Descriptor |
| `Preview` | immutable preview | build now | website factory | Factory → Preview |
| `Connect to CRM` | `events.site`/CRM adapter | integrate now optional | website factory | Factory → Integrations |
| `Dismiss` | defer integration | build now | website factory | Integration decision |
| `Connect` | provider authorization | integrate now optional | website factory | Factory → Integrations |
| `Exploring styles` | template/style selection | build now | website factory | Factory → Templates |
| `Starting live preview` | preview build state | build now | website factory | Factory → Generate |
| `Getting ready` | QA/preparation state | build now | website factory | Factory → Verify |
| `Publish` | `factory.deploy_site` | build now, approval-gated | website factory | Factory → Publish |

## AI-agent evidence gap

Evidence `video-qy0l1t7x6le-ai-agent-tabs` verifies only the visible label
`AI Agents` and spoken voice/text/knowledge concepts. AI-agent sub-tabs remain
pending research: selected and targeted frames did not show a readable sub-tab
view. Therefore names such as studio, voice, conversation, knowledge, templates,
content, and logs are Atlas capability hypotheses/candidate IDs—not validated
observed submenu labels. They remain build later, integrate later, or exclude
pending evidence according to `upsell-capabilities.md`.

## Evidence and change rule

No label may move into the “observed” column without a ledger record containing
that exact label, visual evidence, and `verification: observed`. Spoken methods
may inform workflows but not an identical menu claim. Any new discovery enters
the research ledger and capability lifecycle before it changes Atlas navigation.
