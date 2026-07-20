# BRIEF: P1 Core Services — Codex 5.6 (Sol) lane

**Paste this whole file into Codex as one task AFTER the Antigravity scaffold passes acceptance. Self-contained; the three referenced files are in the repo. Do NOT modify: `supabase/migrations/*`, `SECURITY.md`; `packages/registry/registry.ts` is read-only input (its codegen contract is at the bottom of that file).**

## Inputs in-repo
- `packages/registry/registry.ts` — capability definitions + codegen contract (route path = `/v1/` + id with `.`→`/`).
- `supabase/migrations/0001_init.sql` — schema; RLS expects `set_config('request.space_id', <uuid>, true)` per request and sha256 token compare against `api_tokens`.
- `SECURITY.md` — invariants your code must uphold (esp.: outbound messages need `approved_by`; tokens never decide approvals; audit INSERT on every privileged call; GETs side-effect-free).

## Deliverables
1. **Registry codegen** (`packages/registry/codegen.ts` + build step): generate
   - `apps/api/src/routes.gen.ts` — Fastify route per capability: auth (Bearer token → sha256 → api_tokens lookup → scopes check; or Supabase Auth JWT for operator) → `set_config('request.space_id', …)` → JSON-schema input validation → audit_log insert → handler dispatch → output validation. Capabilities with `requiresApproval: true` insert an `approvals` row and return `{approvalId, status: 'review'}` — they DO NOT execute.
   - `packages/client/src/client.gen.ts` — typed method per capability.
2. **Handler skeletons** (`apps/api/src/handlers/<namespace>.ts`) for every registry capability: implement fully where listed below, stub with typed TODO otherwise.
   - **Implement now:** `status.mission_control` (real queries: pending approvals count, last runs, schedules due, cache-hit rate from runs.answered_by), `approvals.list`, `approvals.decide` (operator-only; on approve, dispatch the held action via a dispatcher map), `memory.ingest` (hash-dedupe upsert into memory_cards + ingest_queue transitions), `runs.execute` (create run row → route by task_class via the router below → update tokens/cost/status), `events.site` (create conversation + inbound message + qualification run enqueue).
3. **Router** (`packages/router/`): port the freellm concept from the sibling repo's `freellm.cjs` design, TypeScript-native: ordered model chain per task_class from env/config; per-call timeout; on 429/5xx/timeout skip to next; queue with concurrency 2 and jittered backoff (free tiers throttle in bursts); every call records tokens_in/out + cost to the run row. Providers: OpenRouter-compatible HTTP first (one adapter), stub interfaces for others.
4. **Scheduler** (`packages/scheduler/` + a Railway-worker entry `apps/api/src/worker.ts`): poll `schedules` due by cron expr, honor `iteration_cap`, execute via `runs.execute`, write outputs needing action to approvals queue. No always-on loop may send anything outbound directly.
5. **Mission Control wiring** (`apps/os`): replace stub cards with real ones — pending approvals (with approve/reject/defer + notes buttons per item, radio-style), live runs feed (poll 5s), model-chain health, cache-hit rate + $-saved counters. Keep the declarative pattern: cards render from `status.mission_control` JSON, not bespoke fetches.
6. **Tests:** vitest — token auth + scope rejection, RLS space scoping (against a local supabase or mocked pg), approval-gate flow (requiresApproval capability never executes without decision), router fallback on simulated 429, scheduler cap enforcement. CI green.

## Acceptance
- `pnpm build && pnpm test` green; `docker build` green.
- Manual: create Space + token (SQL seed script `supabase/seed.sql` — write it), call `POST /v1/memory/ingest` with a token → cards land; `POST /v1/outreach/send` → returns approvalId, message NOT sent; operator approves in UI → dispatcher fires (log-only sender stub).
- Every route writes an audit_log row (assert in tests).

## Style
Strict TS, no `any`, no new deps beyond: fastify ecosystem, zod (may wrap JSON-schema), pino, vitest. Small modules. Follow the security invariants literally — they are the product.
