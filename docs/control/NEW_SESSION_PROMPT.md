# Atlas OS — new session prompt

Paste everything below the line into a new chat in this project.

---

Continue building **Atlas OS**. Do not re-do discovery — this prompt plus the
repo's own control plane is your starting state.

## Read these first, in this order

1. `AGENTS.md` — how to work in this repo
2. `docs/MANUAL.md` — what the system is and how it hangs together
3. `docs/control/CONTROL_INDEX.md` — the control plane and its authorities
4. `docs/control/CURRENT_HANDOFF.md` — the active work item and next exact action
5. `docs/control/CURRENT_STATE.md` — observed reality and the defect history
6. `docs/control/WORK_QUEUE.yaml` — phase status
7. `docs/specs/p2/revenue-pilot.md` and `docs/specs/p2/website-factory.md`

## Working directory

`C:\Users\misha\Documents\BizFramworkCap\atlas-source` — repo `mishaelwillo/atlas-os`.
Windows 11, PowerShell primary, Bash tool available. `pnpm` is installed globally
via npm (corepack fails with EPERM on this machine — do not try to enable it).

## Where the build stands

Main is `fb450a80fe8e6e30fe38e8a07e19d1fe68b4c0a1` with Build & Test green on
that exact SHA. Both services deploy from main. Migrations `0001`–`0011` are
applied and pinned (`expected_migration: 0011_deployment_withdrawal_verdict`,
matched by `ATLAS_SCHEMA_VERSION` on both services). **35 executable
capabilities, 31 candidates**, registry version 3.

- **P1 production** — done and verified live.
- **P2A Intelligence Bank** — build-now scope done.
- **P2B Website Factory** — `review`. The full loop is proven end to end against
  production. The remaining acceptance is the timed benchmark run through
  Mission Control, which needs an operator session.
- **P2C Revenue pilot** — `in_progress`. Every capability is built and has an
  operator surface, and the whole chain has been driven in a browser.

### What was proven against production

The full factory loop: publish → revise → publish v2 → roll back → withdraw,
with the address confirmed gone afterwards. And the full pilot, driven in
Mission Control by a signed-in operator: record a prospect → qualify → demo slot
→ sequence → offer → deal decision → record terms → approved activation. The
funnel reads one paying customer.

### Fixture data is live and should be cleaned up

The `atlas` space holds `Atlas Pilot Fixture Plumbing` (lead `1be4b379…`) with
an assessment, a demo slot, a sequence, offer v1 and v2, an accepted deal and an
**active hosting entitlement**. It is counted in the funnel as a paying
customer, so it will flatter any reading of the pilot until removed. Direct
database access is refused by the permission layer, so removal needs either an
operator-run script or a capability.

## Known gaps and open decisions

- **A directory adapter for lead sourcing.** `leads.find` is a typed stub that
  throws. `leads.record` covers hand sourcing in the meantime. The adapter is an
  integration decision (provider terms, data licensing), not code, and it is what
  blocks the pilot's exit criterion of one *real* hosting-paying customer.
- **A model credential** for `playbooks.author`, without which it records the
  operator's brief rather than running a frontier session.
- **Promoting `agents.logs`** from candidate — evidence-gated.
- **P2B's timed acceptance** needs an operator session.
- **Cleaning up the pilot fixture** (above).
- **`onboarded` and `active`** are reachable hosting states with no capability
  that moves an entitlement into them; `hosting.activate` stops at
  `entitlement_active`. Worth checking before claiming the chain is complete.

## Architecture you must respect

**The capability registry is the single source of truth.**
`packages/registry/registry.ts` generates `apps/api/src/routes.gen.ts` and
`packages/client/src/client.gen.ts`. A capability not in the registry does not
exist. Never hand-wire a route.

**Governance tripwires will block you if you drift:**

- `specifications.ts` pins the executable count (**35**) and the candidate count
  (**31**). Adding a capability without updating both fails the gate — and also
  needs a row in `docs/specs/p2/README.md`'s traceability table.
- `capabilityMetadata` requires lifecycle + owner spec for every capability.
- The research ledger validates evidence IDs and will reject evidence that does
  not name your capability. Use `evidenceIds: []` when you have none.
- Every registry entry declares `execution: 'handler' | 'model'`. Required, not
  defaulted: `runs.execute` used to send every non-approval capability to the
  model router, so a scheduled deterministic check recorded a `succeeded` run
  carrying a model's prose about work that never happened.
- `control:verify` fails on any applied-state claim in a migration comment.
- The generated capability catalog is committed; run
  `pnpm --filter @atlas/registry catalog` after any registry change or CI fails.

**The approval gate.** Empty `scopes` means operator-only
(`apps/api/src/auth.ts`). `requiresApproval` capabilities create an approvals row
and never reach a handler. `apps/api/src/dispatch.ts` is the only place a held
action executes. Pre-approval gates live in `pipeline.ts`, so an operator is
never shown an approval the dispatcher will refuse.

**Determinism.** Same descriptor + template → byte-identical HTML and the same
sha256. Publishing promotes exactly the approved build.

**Sourcing.** Every displayed fact needs a source URL or an explicit
`ownerProvided` marker. `dossier.ts` blocks `unsourced`, `conflicting` and
`malformed` facts. `renderSection` only emits fields the template declares.

**Honest degradation.** `schema_pending` when tables are missing, `queued` with
the provider's reason when a publish fails, `unreadable` when an address cannot
be read, null-not-zero for a rate with no denominator. Keep the pattern — it is
what made every defect in this codebase findable.

**Derive, never restate.** Offered moves come from the rule functions
(`planAdvance`, `planTouchAdvance`, `planDealTransition`), and vocabularies —
rubric thresholds, channels, periods, the twelve disclosures — come from the
API. A hand-written copy is a claim nothing checks; the deal control was the one
that restated them and it offered four moves the API refused.

## Key files

| Area | Path |
|---|---|
| Registry | `packages/registry/registry.ts`, `metadata.ts`, `codegen.ts` |
| Auth / approval | `apps/api/src/auth.ts`, `dispatch.ts`, `pipeline.ts`, `policy.ts` |
| Factory | `apps/api/src/factory/` — `dossier.ts`, `templates.ts`, `render.ts`, `qa.ts`, `publish.ts`, `fingerprint.ts`, `sweep.ts`, `hosting.ts`, `cloudflare-pages.ts` |
| Revenue rules | `apps/api/src/revenue/` — `qualification.ts`, `demo-queue.ts`, `sequence.ts`, `offers.ts`, `hosting-activation.ts`, `activation-read.ts`, `funnel.ts` |
| Handlers | `apps/api/src/handlers/` — `status.ts`, `revenue-cards.ts`, `prospecting.ts`, `sequence.ts`, `offers.ts`, `analytics.ts`, `verify-live.ts` |
| UI | `apps/os/src/MissionControl.tsx`, `ProspectsCard.tsx`, `SequenceCard.tsx`, `RevenueOpsCard.tsx`, `FunnelCard.tsx`, `SiteBuilderCard.tsx`, `QaVerdict.tsx` |
| Control plane | `packages/control-schema/src/` — `verify-static.ts`, `drift.ts`, `collect-observed-state.ts`, `specifications.ts` |
| Migrations | `supabase/migrations/` (through `0011`, all applied) |

## Commands

```bash
pnpm build && pnpm lint && pnpm test && pnpm control:verify
```

Others: `pnpm control:status` (live drift; prefix with `railway run --service api`
for database credentials), `pnpm control:handoff -- --id <slug> --actor Claude
--work-item <ID> --objective ... --next ... --definition-of-done ...`,
`pnpm control:archive-handoff`, `pnpm --filter @atlas/registry catalog`.

## Verification discipline — this matters more than speed

- **Check exit codes, never grep for a success word.** `cmd | grep X || echo
  CLEAN` prints CLEAN when the command *crashes*, and `$?` after a pipe is the
  last command's status, not the one you care about.
- **Chain gates with `&&`, never `;`.** A merge was once chained after
  `gh run watch` with `;` and went through on a red CI.
- **Match a CI run to the exact SHA.** Watching "the latest run" straight after
  a merge can watch the previous one and report a stale success.
- **A test double cannot catch bad SQL or a constraint.** `FakeDb` records
  statements without parsing them. Any statement touching the schema needs a
  transactional dry run (`begin … rollback`) against the real database. A
  read-back once shipped with an uncast parameter and failed in production with
  `42P08` while every unit test passed.
- **A test written from the same assumption as the code proves nothing.** The
  Pages adapter asserted the same wrong request shape it sent, so nineteen
  passing tests confirmed only that the author's misunderstanding was
  self-consistent. No site had ever published.
- **Mutation-test every guard you add.** Break it deliberately, confirm tests
  fail, restore. A guard with no failing mutation is decoration.
- **Anything crossing a CDN must settle before you believe it** — in both
  directions. A withdrawal kept serving for 20–40 seconds after it committed.
- **Deployed is not the same as seen.** Mission Control polls every 5s, so a
  check run immediately after a deploy can read the previous payload.
- **Lint runs after build in CI** — type-aware `typescript-eslint` needs
  workspace `.d.ts` files. Do not reorder. Never run `eslint --fix` blindly; it
  has twice removed type assertions the build needs.

### Merge with a merge commit, never squash

```bash
gh pr merge <n> --merge
```

`control:verify` requires the handoff's recorded code-boundary commit to **exist**
and be an **ancestor of HEAD**. A merge commit keeps the branch commits in main's
history. A squash replays them as one new commit and fails with
`control.handoff_commit_not_ancestor`. Do not pass `--delete-branch`; a deleted
branch turns that into `control.handoff_commit_missing`.

- **Commit on a branch, not on local `main`** — branch protection rejects the push.
- `origin`'s fetch refspec only tracks `main`, so `gh pr create` needs `--head <branch>`.
- **Generate the handoff after committing the work**, so the boundary is a commit
  on the branch; otherwise `control.handoff_boundary_changed` fires.

## Live environment

| Thing | Value |
|---|---|
| Mission Control | `https://os-production-8faf.up.railway.app` |
| API | `https://api-production-78a5.up.railway.app` (Railway service `api`) |
| Published sites | `https://sites.andtronai.com/<slug>` (Cloudflare Pages) |
| Auth | Supabase, ES256 via JWKS, HS256 fallback |
| Cloudflare | account `fd486ea72e20f31937e059f3d14ff0c2`, zone `andtronai.com` = `9613c75aac8b84c6af05c19d9edc4aab` |
| Spaces | `atlas` (`daef9946-…`), `studio` (`9ab8c0b6-…`) |

Env var names (values are set in Railway, do not print them): `DATABASE_URL`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`,
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_PAGES_PROJECT`,
`ATLAS_SITES_BASE_URL`, `ATLAS_SITES_LAYOUT`, `ATLAS_VERIFY_LIVE_INTERVAL_MS`,
`ATLAS_OUTREACH_DAILY_CAP`, `ATLAS_CHAIN_THINK|DO|QUICK`, `ATLAS_MODEL_API_KEY`,
`ATLAS_MODEL_BASE_URL`, `ATLAS_SCHEMA_VERSION`, `ATLAS_GIT_SHA`,
`ATLAS_BUILD_TIME`, `ATLAS_CONTROL_LIVE`.

**Do not pin `ATLAS_GIT_SHA` to a fixed value** — it was removed deliberately so
fingerprints cannot go permanently stale.

## What you cannot do, and what to do instead

- **Mission Control's password is not available to you.** The operator signs in
  themselves. Once they have, you can drive the page through the Claude in Chrome
  tools — `read_page`, `find` and ref-based clicking all work off the DOM, and
  the pane does not need to be visible for those. React state must be updated
  through real events (the native value setter plus an `input`/`change` event),
  never by assigning `.value`.
- **Direct database access may be refused** by the permission layer. Migrations
  are written for review, the operator applies them, and you then pin
  `expected_migration` plus `ATLAS_SCHEMA_VERSION` and verify through
  `control:status`.
- **The Cloudflare API token is Pages-scoped.** It cannot read or write zone
  settings (`403` / `10000`), and no API token can reach bot management on this
  free-plan zone. Zone changes need the dashboard.

## Autonomy granted

The user has authorised working autonomously: branch, implement, test, open a
PR, merge on green CI, and deploy without asking. Confirm before anything
genuinely irreversible or outward-facing — publishing to the live domain,
sending real outreach, destructive database changes, spending money, or changing
account or zone settings.

## How the user wants you to work

Read the memory directory — it holds standing corrections. In particular: do not
build proof-of-concept scripts or demonstrations that were not asked for. Do the
requested scope, finish it completely, and report honestly including what failed
or was skipped.

One pattern is worth carrying forward above all others. Nearly every defect
found in this codebase has been **a claim that nothing checked**: migration
banners that still said "NOT APPLIED" after running; a comment claiming one
Pages project could host many businesses when it could host exactly one; a
handler map whose header claimed completeness was "asserted in tests" that did
not exist; a deploy dispatcher whose comment said the previous deployment "must
step down as this one arrives" while the code made that impossible. When you
find one, do not reword the claim — make it checkable, and let the check fail
first so you know it works.
