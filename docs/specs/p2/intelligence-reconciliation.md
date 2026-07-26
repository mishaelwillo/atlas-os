# Intelligence Foundation ↔ P1 Contract Reconciliation

**Status:** recorded delta; no ownership migration is proposed or approved.
**P1 owner contract:** `briefs/P1-CODEX-services.md` (registry codegen contract in
`packages/registry/registry.ts`).
**P2A target:** `docs/specs/p2/intelligence-foundation.md`.

The intelligence-foundation acceptance tests require that every proposed P2A
change map to the current P1 owner contract, prove backward compatibility or
record an approved migration, and leave `capabilityMetadata.specification`
unchanged until such a migration is accepted. This document is that map.

## Ground rules

1. `capabilityMetadata.specification` for the nine P1-owned capabilities stays
   `briefs/P1-CODEX-services.md`. Nothing in this document changes authority.
2. Every P2A delta below is **additive**: new optional fields, new events, new
   internal records. No existing route path, method, input requirement, output
   field, scope, or `requiresApproval` value changes.
3. Any delta marked *migration-required* is staged only; it must not be
   implemented until a registry-metadata migration is explicitly approved.

## Per-capability reconciliation

### `memory.answer` (P1-owned)

- **P1 contract:** POST `/v1/memory/answer`; input `{query, budget?}`; output
  `{answer, rung, confidence, tokensSpent}`; scope `memory:read`; no approval.
- **P2A target:** every answer returns source/rung/confidence; answers prefer
  approved regional knowledge and label fallback; source-free claims quarantine.
- **Delta:** add optional output fields `sources[]` (evidence/provenance ids)
  and `regionFallback` (boolean). Input unchanged.
- **Compatibility:** additive optional output fields — backward compatible.
  Existing clients ignore unknown fields; generated client regenerates from the
  registry when the schema change is approved through normal Fable review of
  `registry.ts` (RULE in registry header still applies).

### `memory.ingest` (P1-owned)

- **P1 contract:** POST `/v1/memory/ingest`; input `{cards[]}`; output
  `{admitted, skipped}`; scope `memory:write`; hash-dedup.
- **P2A target:** cards carry source, locale/region, tenant, retention class,
  and correlation ID; malformed or source-free cards quarantine instead of
  admitting silently.
- **Delta:** optional per-card fields (`source`, `locale`, `retentionClass`,
  `correlationId`); optional output counter `quarantined`.
- **Compatibility:** additive — cards without the new fields behave exactly as
  in P1 (admitted or skipped by hash-dedup). Backward compatible.

### `memory.distill` (P1-owned)

- **P1 contract:** POST `/v1/memory/distill`; input `{limit?}`; output
  `{nodes, conflicts}`; scheduled; no approval.
- **P2A target:** distilled nodes carry truth state
  (`probable|verified|quarantined`), source provenance, and region scope.
- **Delta:** internal node-record enrichment only; API input/output unchanged.
- **Compatibility:** fully internal — backward compatible.

### `memory.adjudicate` (P1-owned)

- **P1 contract:** POST `/v1/memory/adjudicate`; input `{nodeId, verdict}` with
  verdict enum `verified|probable|quarantined`; approval-gated; operator-only.
- **P2A target:** conflicts adjudicated by operators; regional facts cannot
  overwrite global facts without scoped provenance and conflict review.
- **Delta:** none at the API surface. The regional-overwrite guard is server-side
  validation inside the existing verdict flow.
- **Compatibility:** unchanged contract — backward compatible.

### `runs.execute` (P1-owned)

- **P1 contract:** POST `/v1/runs/execute`; input `{capability, input?}`; output
  `{runId, status}`; scope `runs:write`.
- **P2A target:** every run and tool call is correlated and tenant-scoped; run
  states `queued → running → awaiting_approval|succeeded|failed|cancelled`;
  append-only logs; prompt/tool digests recorded.
- **Delta:** optional input `correlationId`; internal run/log record enrichment
  (digests, cost, tokens, outcome). Output unchanged.
- **Compatibility:** additive — backward compatible.

### `approvals.list` / `approvals.decide` (P1-owned)

- **P1 contract:** GET `/v1/approvals/list` (side-effect-free) and POST
  `/v1/approvals/decide` `{approvalId, decision, notes?}`; operator-only decide.
- **P2A target:** approval latency analytics; playbook and adjudication
  approvals flow through the same queue.
- **Delta:** none at the API surface; new approval *kinds* reuse the existing
  queue records.
- **Compatibility:** unchanged contract — backward compatible.

### `status.mission_control` (P1-owned)

- **P1 contract:** GET `/v1/status/mission_control`; output intentionally open
  (`{type:'object'}`).
- **P2A target:** Mission Control exposes deployment drift, memory freshness,
  pending approvals, runs, cost, outcomes — and must not suppress unknowns.
- **Delta:** additional card payloads inside the already-open output object,
  sourced from the control plane's observed-state collector (drift findings are
  reported verbatim, including `unknown`).
- **Compatibility:** open output schema — backward compatible by construction.

### `bench.run` (P1-owned)

- **P1 contract:** POST `/v1/bench/run`; input `{taskFamily?}`; output
  `{results[]}`; scheduled; feeds the router.
- **P2A target:** bench records gain capability version and prompt digests for
  drift-aware routing analytics.
- **Delta:** internal record enrichment only.
- **Compatibility:** fully internal — backward compatible.

## P2A-owned surface (no reconciliation conflict)

- `playbooks.author` is already owned by
  `docs/specs/p2/intelligence-foundation.md` in `capabilityMetadata` and is
  approval-gated in the registry. P2A implements it under its own authority:
  versioned, immutable-after-approval playbooks
  (`draft → review → approved → active → superseded`).
- `platform.dashboard` and `agents.logs` remain **candidates** in
  `docs/control/CAPABILITY_CANDIDATES.yaml` (evidence:
  `video-qy0l1t7x6le-dashboard-navigation`, `video-qy0l1t7x6le-ai-agent-tabs`
  with a recorded gap for unreadable sub-tabs). They generate no executable
  routes until promoted through the capability lifecycle.

## Migration register

No entry. Every P2A delta above is additive or internal; no change requires a
`capabilityMetadata.specification` transfer or a breaking registry change. If a
future increment needs one, it must be recorded here with its approval decision
before implementation.

## Implementation order (build-now scope from the owning spec)

1. Card/node/run record enrichment behind existing routes (internal, additive).
2. Quarantine path for malformed/source-free ingest.
3. `playbooks.author` execution under approval (P2A-owned).
4. Mission Control drift/freshness cards from observed state.
5. Agent audit views (candidate promotion gated on evidence).
