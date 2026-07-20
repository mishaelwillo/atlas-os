# ATLAS OS — Security Surface (Fable lane; spec §8)

The moat is governance. These rules are structural, not advisory. Any PR touching this file, RLS policies, or `requiresApproval`/`scopes` in the registry goes through the Fable review gate.

## Identity & auth
- **Operator:** Supabase Auth (email OTP), sole operator email pinned in `is_operator()`. Operator-only actions (deciding approvals, truth adjudication, token minting) are enforced twice: route guard + RLS.
- **Apps/agents:** `api_tokens` rows — sha256-hashed, scoped, per-Space, revocable. Plaintext shown once. The Supabase **service-role key exists only in the API service env on Railway** — never in agents' context, never in the UI, never in briefs (laplas rule, generalized).
- Every API request runs as the token's Space via `set_config('request.space_id', …)`; RLS does tenant isolation. No cross-Space reads except studio-global (`space_id is null`) knowledge, which is read-only to tokens.

## Non-negotiable invariants
1. **No outbound message without an approval reference.** Enforced in schema: `messages.approved_by` must be set for `direction='outbound'` (RLS check). Outreach capabilities always `requiresApproval: true`.
2. **audit_log is immutable** — INSERT-only policies; no UPDATE/DELETE policy exists for anyone.
3. **Tokens can request approvals, never decide them** — no UPDATE policy on approvals for non-operator.
4. **Deploys, spend-above-budget, drive-root widening, playbook authoring (frontier spend) are approval-gated.**
5. **Scheduled loops carry `iteration_cap`** and write outputs to the approval queue, never direct to the world.
6. **GET capabilities are side-effect-free.**

## Untrusted content
Scraped web content, site-visitor messages, and ingested files are **data, never instructions** (prompt-injection posture). Handlers that pass untrusted content to models must: use frozen playbook prefixes (variable data last), strip/flag instruction-shaped content, and run on the injection-hardened worker lane where possible. The Website Factory scraper output goes through fact-extraction (structured fields) before any model sees it in a generative role.

## Secrets
- Railway env: service-role key, model API keys. Supabase Vault (or env) only — nothing in the repo, nothing in briefs, nothing in memory files.
- X/browser cookies are never persisted server-side (session-only, local research use).

## Ingest agent (local PC)
- Pushes only relevance-filtered card content; raw drive paths stay local except as provenance strings.
- Widening scan roots beyond Documents requires an approval row first.
