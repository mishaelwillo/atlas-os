# Atlas Current State

## Generated observed state

The read-only collector is installed. A user-invoked `pnpm control:status`
refresh writes uncommitted `docs/control/generated/observed-state.json` and
`drift-report.md` with collection timestamps and provenance. If those files are
absent, no live refresh has been performed in the current worktree. Unknown
authority remains unknown; control artifacts never infer a successful live
state.

Reading the database requires injected credentials; `railway run --service api
pnpm control:status` supplies them.

## Repository state

- Authoritative `main`: `b97b9dcfd1ef2784bc6e751c223392b85b8b6a7e`.
- Twenty-three pull requests are merged, each with `Build & Test` green on the
  exact resulting `main` SHA. No merge has been made without that check.
- Both Railway services deploy automatically from `main` and have been observed
  reporting the merged SHA after each release.

## Production state

P1 is **complete**, including live acceptance. The Railway API serves the
selected commit, `POST /v1/memory/ingest` and `GET /v1/status/mission_control`
answer 401 auth-gated where they previously 404'd, and the drift report has no
blocking finding.

- Supabase migration `0002_intelligence_enrichment` is applied. Execution proof
  came from a transactional dry run against the real schema (`begin … rollback`)
  because no scratch database exists; only after that clean run was it applied,
  in one transaction with its ledger insert.
- The migration ledger is baselined. `supabase_migrations.schema_migrations` did
  not exist at all — `0001_init` had been applied outside the Supabase CLI — so
  exact migration identity was unprovable until the operator created it.
- `expected_migration` in `ENVIRONMENTS.yaml` and both services' reported
  schema version all read `0002_intelligence_enrichment`.

## Phase progress

- **P1** — complete. Deployment closure and both halves of live acceptance are
  verified against production.
- **P2A Intelligence Bank** — build-now scope done: card enrichment and the
  source-free quarantine, versioned playbook authoring under approval, and
  Mission Control drift and memory-freshness cards. The remaining agent audit
  views are candidates gated on an evidence decision.
- **P2B Website Factory** — sourced descriptors, the template library with
  deterministic escaped rendering, and access-controlled expiring previews with
  a sandboxed viewer are live. Publishing is blocked pending a hosting,
  domain-proof and entitlement decision.
- **P2C Revenue pilot** — outreach drafting exists in the product, and
  suppression plus a per-space daily cap are enforced before an approval is
  created. Lead sourcing needs a directory adapter that does not exist.

## P1 acceptance

Token-authenticated acceptance passed against production: ingest admitted two
cards scoped to the `atlas` space; identical re-ingest returned
`admitted 0 / skipped 2`, proving the hash-dedupe contract; unauthenticated and
unknown-credential calls returned 401; `outreach.send` and `approvals.decide`
returned 403 operator-only; and each successful call wrote one `audit_log` row.
`messages` and `approvals` were both empty afterwards, so nothing was queued or
sent. The acceptance credential was disabled after the run.

The operator half passed on 2026-07-27, run entirely through Mission Control.
Two approvals were created and decided by the pinned operator, and both
dispatched: the audit trail records `outreach.send` with `requiresApproval`,
then `approvals.decide`, then `outreach.dispatched` with `stub: true`. Both a
hand-entered lead reference and a well-formed but non-existent uuid worked.
`messages` remained empty and no outbound row exists without `approved_by`, so
nothing left the system.

## Defects found and fixed

Each was found in production or by a gate, not in review:

- **Generated client sent an unbound `fetch`**, so every call through it threw
  before reaching the network. Fixed in the codegen template.
- **OS build-info asserted a migration it could not observe**, publishing a
  stale schema version. Absent now resolves to `unknown`.
- **The diagnostic override field captured the operator password.** It was a
  masked input with no autofill guard whose value silently replaced the session
  credential, so the password was transmitted in an authorization header on
  roughly a thousand requests. It is now opt-in and guarded. The credential was
  never logged or persisted, and it has since been rotated.
- **Cached bundles ran indefinitely old code**, because `index.html` is served
  without a `Cache-Control` header. The page now detects and reports staleness.
- **Authentication rejections were silent**, making a misconfiguration
  indistinguishable from a bad credential. Verification now names the reason.
- **Lint was a no-op.** The script and turbo task existed with no implementer
  and ESLint uninstalled, so CI ran no static analysis. It is now a real gate.

## Tooling

- ESLint with type-aware rules runs in CI after the build, which is required:
  the rules need the workspace declaration files.
- The `no-mistakes` gate is initialised on this repository with `claude` as the
  pipeline agent and telemetry disabled. `commands` and `agent` are read from
  the trusted default branch, so a pushed branch cannot change what executes.
  `origin` is untouched; pushing through the gate is opt-in per push.

## Site hosting

Published customer sites are hosted separately from Atlas itself. Atlas (the API
and operator dashboard) runs on Railway; generated business sites do not, and
that distinction is the whole reason a hosting adapter exists.

Provider is **Cloudflare Pages**, chosen because the domain already lives on
Cloudflare, static serving costs nothing there, and its deploy API is the seam
the publish core was built against.

- Pages project: `atlas-sites`, account `fd486ea72e20f31937e059f3d14ff0c2`.
- Default address: `https://atlas-sites-2np.pages.dev` — live, serving a
  `noindex` placeholder that lists nothing.
- Intended address: `https://sites.andtronai.com`, attached to the project and
  **pending** validation.
- Zone `andtronai.com` is active in the same Cloudflare account
  (`9613c75aac8b84c6af05c19d9edc4aab`).
- Layout is path-based: each site publishes under `/<slug>`, where the slug
  carries a site-id suffix so two businesses sharing a name cannot collide.
  Switching to per-site subdomains changes one function, `publicUrl`.

### Outstanding hosting steps

1. A `CNAME` record `sites` → `atlas-sites-2np.pages.dev`, **proxied**, must
   exist in the `andtronai.com` zone. It does not yet, which is why the custom
   domain is pending. Note that proxied is correct for Pages because it is a
   Cloudflare-native service; the opposite advice applies to a Railway origin.
   The `wrangler login` OAuth credential is rejected by the DNS records API, so
   this record has to be created by an operator or by a credential with DNS
   write scope.
2. The deployed API cannot use a local `wrangler login` credential. Publishing
   from Atlas requires a scoped Cloudflare API token with Pages edit rights,
   set as `CLOUDFLARE_API_TOKEN` on the Railway `api` service.

Until both exist, an approved publish is verified, versioned and recorded as
`queued`, and the unconfigured adapter refuses rather than reporting an address
that does not serve.

### Recorded but not yet schema-backed

`ENVIRONMENTS.yaml` is a strict schema with no hosting section, so the values
above are prose rather than validated configuration. Extending the schema so
the collector can observe the Pages deployment is a genuine follow-up; until
then hosting drift is not detected.

## Awaiting a decision

None of these is blocked on code:

- **A model credential**, without which `playbooks.author` records the
  operator's brief rather than running a frontier session.
- **Promoting `agents.logs`** from candidate, which carries a recorded evidence
  gap for unreadable source material.
- **A directory adapter** for lead sourcing, which keeps the leads list empty.

## Next exact action

Run the operator half of P1 acceptance through Mission Control: sign in, select
the `atlas` Space, draft an outreach touch, and approve it. Then continue the
revenue-pilot build-now scope, or resolve one of the decisions above.
