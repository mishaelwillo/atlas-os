# Atlas Continuity Control Plane — Design

**Status:** Proposed for approval
**Date:** 2026-07-24
**Product:** Atlas OS
**Repository:** `mishaelwillo/atlas-os`
**Initial regions:** United States, wider North America, Caribbean
**Primary P2 direction:** Intelligence foundation → Website Factory → revenue pilot → recurring-service upsells

## 1. Purpose

Atlas must remain understandable and safely transferable when work moves between Codex, Claude, AntiGravity, a human operator, or another model with no retained conversation context.

The continuity system must prevent four recurring failures:

1. A new model repeats discovery that was already completed.
2. A planning document claims something that the repository does not implement.
3. The repository claims something is deployed when Railway is serving an older build.
4. Database, deployment, research, roadmap, and active-work state drift without being detected.

The solution is a small **Continuity Control Plane** stored in the Atlas repository. It combines durable direction, machine-readable state, generated evidence, explicit decisions, and a strict handoff protocol.

## 2. Design principles

### 2.1 One entry point

Every model starts with `AGENTS.md`, which points to `docs/control/CONTROL_INDEX.md`. The index tells the model what is authoritative, what is generated, what to read for the current task, and which command refreshes observed state.

### 2.2 Authority is explicit

Different systems are authoritative for different facts:

| Fact | Authority |
|---|---|
| Product direction and non-negotiable doctrine | Versioned product and decision documents |
| Intended phase scope | Versioned roadmap |
| Implemented code | Git commit |
| Registered platform capabilities | `packages/registry/registry.ts` |
| Database structure | Supabase migration files plus live migration verification |
| Runtime data state | Live Supabase |
| Deployed application version | Runtime build fingerprint returned by Railway services |
| CI status | GitHub Actions |
| Current work and next step | Active handoff record |
| Video/research claims | Evidence ledger with source, timestamp, confidence, and interpretation |

No single prose status page may override these authorities.

### 2.3 Desired state and observed state stay separate

The repository records desired direction. Verification scripts record observed GitHub, Supabase, and Railway state. A reconciliation report compares them.

The system must never silently rewrite desired direction to match a broken deployment, and it must never describe a desired deployment as if it were already live.

### 2.4 Evidence before status

Words such as `complete`, `deployed`, `working`, and `verified` require recorded evidence:

- commit SHA;
- command or API check;
- timestamp;
- environment;
- result;
- remaining caveats.

### 2.5 No secrets in continuity artifacts

Environment records contain variable names, service IDs, safe URLs, schema versions, and secret-provider references. They never contain secret values, tokens, private keys, or copied environment files.

### 2.6 Every future capability is retained without crowding the product

Capabilities discovered in videos, customer requests, competitors, or experiments enter a lifecycle:

`observed → catalogued → candidate → experiment → validated → production → core`

Additional terminal states are `deferred`, `integration-only`, `rejected`, `superseded`, and `retired`.

Production navigation displays only capabilities enabled for the current tenant and plan.

## 3. Canonical repository structure

```text
AGENTS.md
docs/
  control/
    CONTROL_INDEX.md
    PRODUCT_DIRECTION.md
    ROADMAP.md
    CURRENT_STATE.md
    CURRENT_HANDOFF.md
    ENVIRONMENTS.yaml
    WORK_QUEUE.yaml
    RESEARCH_LEDGER.yaml
    CAPABILITY_LIFECYCLE.md
    DEPLOYMENT_RUNBOOK.md
    decisions/
      README.md
      ADR-0001-continuity-authority.md
    handoffs/
      README.md
      archived/
    generated/
      observed-state.json
      drift-report.md
      capability-catalog.md
      route-catalog.md
  specs/
    p2/
      README.md
      regional-packs.md
      intelligence-foundation.md
      website-factory.md
      revenue-pilot.md
      upsell-capabilities.md
scripts/
  control/
    collect-observed-state.ts
    verify-continuity.ts
    create-handoff.ts
    archive-handoff.ts
packages/
  control-schema/
    package.json
    tsconfig.json
    src/
      index.ts
      schemas.ts
      schemas.test.ts
```

The generated directory contains facts produced by tools. Humans and models do not manually edit generated files.

## 4. Core control documents

### 4.1 `CONTROL_INDEX.md`

The mandatory starting point. It contains:

- project identity and repository;
- five-minute orientation route;
- authority table;
- current phase;
- links to active specifications;
- exact state-refresh command;
- exact handoff command;
- stop conditions;
- freshness indicators.

It stays short enough to read at the beginning of every session.

### 4.2 `PRODUCT_DIRECTION.md`

Contains durable doctrine:

- Atlas is a global control plane with regional specialization;
- initial regions are the United States, wider North America, and Caribbean;
- the Website Factory is the entry product;
- the website is the customer-acquisition wedge;
- recurring revenue comes from hosting and capability upsells;
- governance, owned memory, verification, and replaceable adapters are platform principles;
- feature parity with GoHighLevel is not the objective;
- the presenter’s workflow is preserved while the product remains Atlas-native.

This document changes only through an explicit decision record.

### 4.3 `ROADMAP.md`

The phase model becomes:

- **P0:** AntiGravity scaffold and initial deployment.
- **P1:** Claude core services.
- **P1 deployment closure:** live Railway API must serve the P1 commit and pass acceptance.
- **P2A:** Intelligence Bank, continuity controls, Capability Registry lifecycle, and regional packs.
- **P2B:** Website Factory.
- **P2C:** Minimum complete revenue pilot.
- **P3:** Recurring-service expansion and scaling.

Every phase has entry evidence, exit evidence, and dependencies.

### 4.4 `CURRENT_STATE.md`

A human-readable summary generated from authoritative evidence. It reports:

- repository head and CI result;
- local worktree and branch;
- Supabase schema state;
- Railway API and OS fingerprints;
- active phase;
- completed and incomplete exit criteria;
- drift;
- blockers;
- next exact action.

The file clearly marks generated and human-authored sections.

### 4.5 `CURRENT_HANDOFF.md`

The only active handoff record. It contains:

- handoff ID;
- start and update timestamps;
- model or human actor;
- objective;
- active plan and task;
- base and head commits;
- files changed;
- tests and evidence;
- database actions;
- hosting actions;
- external side effects;
- decisions made;
- assumptions;
- unresolved questions;
- blockers;
- next exact command or file;
- definition of done.

When work completes or is superseded, the record moves to `handoffs/archived/` and a new active record is created.

### 4.6 `ENVIRONMENTS.yaml`

Machine-readable non-secret environment inventory:

```yaml
schema_version: 1
environments:
  production:
    github:
      repository: mishaelwillo/atlas-os
      branch: main
    supabase:
      project_ref: yyyspvralawnvhtmuyvg
      expected_migration: 0001_init
    railway:
      api:
        public_url: https://api-production-78a5.up.railway.app
        health_path: /healthz
      os:
        public_url: https://os-production-8faf.up.railway.app
        health_path: /
    required_variable_names:
      - SUPABASE_URL
      - SUPABASE_SERVICE_ROLE_KEY
      - OS_APP_ORIGIN
      - VITE_API_URL
      - VITE_SUPABASE_URL
      - VITE_SUPABASE_ANON_KEY
```

Secret values are prohibited.

### 4.7 `WORK_QUEUE.yaml`

The active and upcoming work is machine-readable. Each item contains:

- stable ID;
- phase;
- title;
- status;
- priority;
- dependencies;
- specification;
- owner or active actor;
- branch;
- acceptance checks;
- evidence links;
- blocked reason;
- next action.

Only one item per actor may be `in_progress`.

### 4.8 `RESEARCH_LEDGER.yaml`

The video research and later discoveries are recorded as evidence, not as unqualified truth.

Each entry contains:

- stable evidence ID;
- source URL or local artifact;
- source type;
- timestamp or frame;
- observed feature or claim;
- confidence;
- conflict or incentive note;
- Atlas interpretation;
- linked capability IDs;
- linked specification;
- verification status.

Presenter-reported prices and revenue claims remain visibly distinct from validated market recommendations.

## 5. Machine-readable state model

`packages/control-schema` defines strict schemas for:

- environment inventory;
- work queue;
- research evidence;
- handoff;
- observed state;
- drift findings.

The schema package provides:

```ts
export type DriftSeverity = 'info' | 'warning' | 'blocking';
export type WorkStatus = 'queued' | 'ready' | 'in_progress' | 'blocked' | 'review' | 'done';
export type CapabilityStage =
  | 'observed'
  | 'catalogued'
  | 'candidate'
  | 'experiment'
  | 'validated'
  | 'production'
  | 'core'
  | 'deferred'
  | 'integration-only'
  | 'rejected'
  | 'superseded'
  | 'retired';
```

Invalid control files fail verification and CI.

## 6. Runtime fingerprinting

The API health response must evolve from:

```json
{"ok":true,"version":"0.1.0"}
```

to:

```json
{
  "ok": true,
  "service": "atlas-api",
  "appVersion": "0.1.0",
  "gitSha": "6b70726b1e...",
  "buildTime": "2026-07-24T00:00:00Z",
  "schemaVersion": "0001_init",
  "registryVersion": 1
}
```

The OS exposes equivalent build metadata through a public JSON asset or safe status endpoint.

This lets a model prove which commit Railway is actually serving.

## 7. Observed-state collection

`collect-observed-state.ts` performs read-only checks:

1. Read local Git branch and commit.
2. Read GitHub default-branch head and CI conclusion.
3. Query Supabase migration and required-table state using an approved verification connection.
4. Query Railway API health and route fingerprints.
5. Query OS build metadata.
6. Compare registry-generated routes with the deployed route fingerprint.
7. Write `generated/observed-state.json`.
8. Write `generated/drift-report.md`.

Unavailable credentials produce an explicit `unknown` result, never a false success.

## 8. Drift rules

Blocking drift includes:

- Railway serves a commit older than the expected production commit.
- Required API routes are absent.
- live schema is behind required migrations;
- a phase is marked complete without exit evidence;
- an active handoff references a missing plan, branch, or work item;
- generated registry routes differ from checked-in generated routes;
- a destructive or outbound action lacks approval evidence.

Warning drift includes:

- stale handoff;
- stale observed-state snapshot;
- CI result unknown;
- local branch differs from the active handoff;
- documentation references a superseded decision.

Informational drift includes expected development differences such as local commits not yet selected for production.

## 9. Capability lifecycle integration

The existing TypeScript registry remains authoritative for executable capabilities. It gains lifecycle metadata rather than being replaced by a second registry.

Each capability records:

- lifecycle stage;
- phase;
- menu group;
- regional availability;
- required entitlements;
- monetization role;
- dependencies;
- source evidence;
- specification path;
- implementation mode: `build`, `integrate`, `partner`, or `research`;
- owner;
- acceptance checks.

The generated capability catalog lets non-coding models understand the platform without reading TypeScript.

## 10. Video workflow integration

The presenter’s workflow becomes a linked chain of capabilities:

```text
market.research
→ leads.find
→ leads.enrich
→ factory.build_descriptor
→ factory.generate_site
→ factory.verify_site
→ factory.publish_site
→ outreach.compose
→ outreach.send
→ conversations.receive
→ appointments.book
→ billing.activate_hosting
→ growth.recommend_upsell
```

The evidence ledger points from each observed video feature to its capability and specification. No feature is lost merely because it is deferred.

## 11. Regional specialization

Regional packs are versioned data and policy modules, not code forks.

Each pack may define:

- countries and subdivisions;
- languages and language variants;
- currencies;
- telephone and address formatting;
- tax and invoice notes;
- consent and outreach constraints;
- preferred messaging channels;
- directory sources;
- review platforms;
- local SEO conventions;
- domain recommendations;
- holidays;
- vertical priorities;
- pricing evidence;
- website templates and copy rules.

The initial pack hierarchy is:

```text
global
├── north-america
│   ├── united-states
│   └── canada
└── caribbean
    ├── saint-lucia
    ├── jamaica
    └── trinidad-and-tobago
```

Country packs inherit from their parent and override only regional differences.

## 12. Model takeover protocol

### Start of every session

1. Read `AGENTS.md`.
2. Read `CONTROL_INDEX.md`.
3. Read `CURRENT_HANDOFF.md`.
4. Run `pnpm control:status`.
5. Stop if blocking drift exists.
6. Read only the active specification and directly linked evidence.
7. Confirm the active work item and branch.

### During work

- Update the active handoff after each independently reviewable task.
- Record decisions that change scope as ADRs.
- Record external writes immediately.
- Preserve exact commands and evidence for failures.
- Never mark a task complete before its acceptance checks pass.

### Before stopping

1. Run targeted tests.
2. Run `pnpm control:verify`.
3. Update files changed, evidence, and external state.
4. Record the next exact action.
5. Record whether work is safe to continue.
6. Commit the handoff with the code it describes whenever practical.

## 13. GitHub, Supabase, and Railway harmony

The control plane uses a reconciliation model:

```text
Repository desired state
        +
GitHub commit and CI evidence
        +
Supabase schema/runtime evidence
        +
Railway deployed-build evidence
        ↓
Observed state and drift report
        ↓
Current state and next action
```

GitHub, Supabase, and Railway remain independent authorities. “Harmony” means differences are detected, explained, and resolved—not hidden by a manually edited status paragraph.

## 14. Immediate Atlas baseline

The initial observed baseline is:

- GitHub repository exists at `mishaelwillo/atlas-os`.
- GitHub `main` head is `6b70726b1e`.
- GitHub Actions pass for P1 and its three follow-up fixes.
- The detached local Atlas copy matches all 81 GitHub-tracked blobs.
- Supabase has all 18 tables from `0001_init`.
- The OS Railway service is online.
- The API Railway service still serves the P0 route set:
  - anonymous Mission Control returns `200` with empty cards;
  - `POST /v1/memory/ingest` returns `404`.
- Therefore P1 code is complete but P1 production API deployment closure is incomplete.

This baseline must become the first generated drift report.

## 15. Implementation boundaries

The first continuity release will:

- create the control documents and schemas;
- add runtime build fingerprints;
- collect Git, GitHub, Supabase, and Railway evidence;
- generate a drift report;
- enforce control-file validation in CI;
- create and archive handoffs;
- extend capability metadata;
- establish the P2A/P2B/P2C roadmap;
- preserve the video evidence and regional-pack direction.

It will not:

- store secrets;
- automatically deploy;
- automatically migrate production;
- automatically resolve drift;
- automatically promote capabilities;
- allow models to send outreach or spend money;
- replace GitHub, Supabase, or Railway as the authority for their respective facts.

## 16. Acceptance criteria

The design is successfully implemented when:

1. A model with no conversation history can find the active phase, task, specification, branch, blockers, and next command in under five minutes.
2. `pnpm control:status` reports repository, CI, Supabase, Railway, and registry state.
3. The current P0-versus-P1 Railway API drift is detected as blocking.
4. A handoff can be created and archived without manually reconstructing repository state.
5. CI rejects invalid control files and generated-route drift.
6. Runtime endpoints identify their deployed commit and schema version.
7. Capability documentation is generated from the executable registry.
8. Video evidence links to capabilities and specifications.
9. Regional packs inherit from global policy without forking application code.
10. No continuity artifact contains a secret value.

## 17. Decision requested

Approve this design as the continuity foundation for Atlas. After approval, the implementation plan will break it into independently testable work:

1. Documentation and schemas.
2. Runtime fingerprints.
3. Observed-state collector and drift engine.
4. Handoff tooling.
5. Capability lifecycle extension.
6. Regional-pack foundation.
7. CI and deployment verification.
8. P1 production deployment closure.
