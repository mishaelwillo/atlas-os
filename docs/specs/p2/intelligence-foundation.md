# Intelligence Foundation

## Purpose

Make Atlas knowledge, decisions, capability state, model activity, and playbooks
owned, attributable, verifiable, and portable so another model can resume from
the repository control entry point without rediscovery.

This document is the P2A target/delta and reconciliation specification. It does
not replace the current owner specification for existing P1 capabilities.
`memory.answer`, `memory.ingest`, `memory.distill`, `memory.adjudicate`,
`runs.execute`, `approvals.list`, `approvals.decide`,
`status.mission_control`, and `bench.run` remain owned by
`briefs/P1-CODEX-services.md` until an approved registry-metadata migration
changes that authority. P2A work must first reconcile this target against the P1
contract and record any compatible delta.

## Users

Operators review truth and approvals; builders/models query memory and execute
capabilities; administrators govern entitlements and retention; analysts monitor
quality, cost, drift, and outcomes.

## Inputs and outputs

Inputs: sourced cards, repository state, evidence IDs, task context, capability
requests, model evaluations, and human decisions. Outputs: deduplicated cards,
truth-rated nodes, answers with rung/confidence, versioned playbooks, runs,
approvals, agent logs, Mission Control status, and handoff evidence.

## UI and menu

Mission Control summarizes deployment drift, active work, memory freshness,
pending approvals, runs, cost, and outcomes. Intelligence Bank exposes sources,
nodes, conflicts, playbooks, and provenance. Governance exposes approvals and
agent logs. Settings exposes retention and adapter policy.

## Workflow and states

Memory: `captured → admitted|skipped → distilled → probable|verified|quarantined
→ superseded`. Playbook: `draft → review → approved → active → superseded`.
Run: `queued → running → awaiting_approval|succeeded|failed|cancelled`. Logs are
append-only. Repository code/DB migrations/hosting fingerprint retain their
separate authority.

## Data entities

Existing `memory_card`, `memory_node`, `run`, `approval`, audit and model-bench
records are extended with source, region, tenant, capability version, prompt/tool
digests, decision, outcome, retention class, and correlation ID. `playbook` and
`playbook_version` remain tenant-owned and immutable after approval.

## APIs, events, and integrations

Defines the P2A delta for the existing P1-owned `memory.answer`,
`memory.ingest`, `memory.distill`, `memory.adjudicate`, `runs.execute`,
`approvals.list`, `approvals.decide`, `status.mission_control`, and `bench.run`;
it does not claim current ownership. It owns the P2A `playbooks.author` target
and candidate `platform.dashboard` and `agents.logs` views. Events:
`memory.*`, `playbook.*`, `run.*`, `approval.*`, `agent.tool_called`, and
`control.drift_detected`.

## Permissions, approvals, and autonomy

Tenant/source isolation, scoped tokens, and operator-only adjudication apply.
`playbooks.author` and truth adjudication require approval. Answering and routing
may use thresholds; source-free claims are quarantined. Logs never grant replay
authority. Autonomy changes require metadata, tests, and an approval decision.

## Regional behavior

Memory stores source locale and resolved region; answers prefer approved regional
knowledge and clearly label fallback. Currency/date/phone rendering uses the
active pack. Regional facts cannot overwrite global facts without scoped
provenance and conflict review.

## Entitlement and monetization

Core memory, Mission Control, approvals, and audit are platform/operations
entitlements. Playbook authoring is operational capability. Cost and token
metrics support unit economics but do not become customer-facing claims.

## Evidence

Repository control artifacts are authority. `video-qy0l1t7x6le-dashboard-navigation`
supports the dashboard candidate; `video-qy0l1t7x6le-ai-agent-tabs` supports
agent-log staging only with an explicit evidence gap for unreadable sub-tabs.

## Analytics

Memory freshness, admission/deduplication, conflict rate, answer rung/confidence,
human override, playbook reuse, approval latency, run success/failure, tool error,
cost, tokens, drift age, and resume/discovery time.

## Errors and recovery

Quarantine malformed/source-free memory; retry idempotent ingestion; surface
conflicts; preserve prior playbook versions; cancel stuck runs; redact provider
errors; and make stale/unknown runtime state visible rather than inferred.

## Security and privacy

Encrypt tenant data, redact secrets/PII in logs, apply retention and deletion,
hash large payloads, restrict raw prompt/tool access, audit export, and defend
against prompt injection in sourced content. Never store credentials in memory.

## MVP exclusions

No autonomous policy changes, cross-tenant learning from private data, hidden
chain-of-thought storage, vendor-specific agent studio, or claim that unknown live
state matches Git.

## Acceptance tests

- Every answer returns source/rung/confidence; conflicts can be adjudicated.
- Every run and tool call is correlated and tenant-scoped.
- Approved playbooks are versioned, diffable, and resumable.
- Mission Control exposes P1 deployment drift and does not suppress unknowns.
- Agent logs are auditable without secrets or private reasoning.
- Reconciliation maps every proposed P2A change to the current P1 owner contract,
  proves backward compatibility or records an approved migration, and leaves
  `capabilityMetadata.specification` unchanged until that migration is accepted.

## Progressive integration

- **build now:** owned memory, truth review, playbooks, Mission Control, approvals,
  agent audit, and handoff continuity.
- **integrate now:** replaceable model/observability adapters with redaction.
- **build later:** regional retrieval evaluation and validated agent assistants.
- **exclude pending evidence:** vendor AI-agent sub-tab parity and opaque memory.
