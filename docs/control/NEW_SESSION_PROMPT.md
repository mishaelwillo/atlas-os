# Atlas OS — new session prompt

Paste everything below the line into a new chat in this project.

---

Continue building **Atlas OS**. Do not re-do discovery — this prompt plus the
repo's own control plane is your starting state.

## Read these first, in this order

1. `AGENTS.md` — how to work in this repo
2. `docs/control/CONTROL_INDEX.md` — what the control plane is and its authorities
3. `docs/control/CURRENT_HANDOFF.md` — the active work item and next exact action
4. `docs/control/CURRENT_STATE.md` — observed reality, and the defect history worth knowing
5. `docs/control/WORK_QUEUE.yaml` — phase status
6. `docs/specs/p2/revenue-pilot.md` — the spec that owns the current work item
7. `docs/specs/p2/website-factory.md` — the spec that owns the factory the pilot drives

## Working directory

`C:\Users\misha\Documents\BizFramworkCap\atlas-source` — repo `mishaelwillo/atlas-os`.
Windows 11, PowerShell primary, Bash tool available. `pnpm` is installed globally
via npm (corepack fails with EPERM on this machine — do not try to enable it).

## Where the build stands

Main is `a68f3c46a2ae94dbb4bd8ba2e15d1e50e7ae0f8f` with Build & Test green on that
exact SHA. Both services deploy from main. Migrations `0001` through `0010` are
applied and pinned. 33 executable capabilities, 31 candidates.

- **P1 production** — done and verified live.
- **P2A Intelligence Bank** — build-now scope done.
- **P2B Website Factory** — `review`. Build-now scope complete and proven against
  production; the remaining acceptance is a timed benchmark run through Mission
  Control, which needs an operator session.
- **P2C Revenue pilot** — `in_progress`. This is the active work.

### The factory is proven end to end

A publish goes: build → 28 QA checks → approval → deploy → live → the public
address read back and its fingerprint recorded → swept hourly thereafter. Verified
against production on 2026-08-04 with `fingerprint_matches: true` and a healthy
sweep.

### The P2C API is complete and has no operator surface

Twelve capabilities are built, migrated and deployed, and **Mission Control has
cards for none of them**:

| capability | what it does |
|---|---|
| `prospecting.qualify` | scores a prospect against the pilot rubric; records an append-only assessment |
| `prospecting.workspace` | read-only review: standing verdict, demo slot, outreach readiness |
| `demos.enqueue` / `demos.advance` | the 5–10 capped demo queue and its state machine |
| `automation.sequence` | plans an outreach sequence; cannot send and cannot record a send |
| `sequence.advance` / `sequence.state` | touch outcomes, and what is eligible next |
| `offers.publish` | immutable offer versions; no default price, no default currency |
| `deals.decide` | records a human's deal decision; it does not make one |
| `hosting.activate` / `hosting.cancel` | approval-gated activation and cancellation |
| `hosting.state` | offer, decision and entitlement for one lead |

`analytics.funnel` is the one exception — it has a card.

## The active work item

`P2C-REVENUE-001`. The next exact action:

> Build the Mission Control surface for the P2C capabilities, so an operator can
> run the revenue pilot through the product rather than through the API.

Definition of done: **an operator can qualify a prospect, queue a demo, plan and
advance an outreach sequence, publish an offer, record a deal decision, and see
hosting state — all from Mission Control.**

This is pure build-now scope. It needs no decision from the user and no new
migration; every table it reads is already applied.

### The UI doctrine you must follow

Mission Control renders the declarative JSON from `status.mission_control`. Cards
do **not** fetch their own data (`apps/os/src/MissionControl.tsx` header, brief §5).
Add data to the status payload and a `kind` to the card union. The cards that do
call the client — the site builder, the sites preview, the outreach draft — do so
only to *act*, never to read the data they display.

Copy the shape from `FunnelCard.tsx` (pure render of payload data) and
`SiteBuilderCard.tsx` (a form that calls a capability and reports what came back).

`QaVerdict.tsx` is worth reading for the standard this codebase holds UI to: the
API distinguishes "unknown" from "zero", and the component renders an em dash
rather than throwing that distinction away at the last step.

## Architecture you must respect

**The capability registry is the single source of truth.** `packages/registry/registry.ts`
generates `apps/api/src/routes.gen.ts` and `packages/client/src/client.gen.ts`.
A capability not in the registry does not exist. Never hand-wire a route.

**Governance tripwires will block you if you drift:**

- `specifications.ts` pins the exact executable capability count — **33** — and the
  candidate count — **31**. Adding a capability without updating both fails the gate.
- `capabilityMetadata` requires lifecycle + owner spec for every capability.
- Every registry entry declares `execution: 'handler' | 'model'`. Required, not
  defaulted: `runs.execute` used to send every non-approval capability to the model
  router, so a scheduled deterministic check recorded a `succeeded` run carrying a
  model's prose about work that never happened.
- The research ledger validates evidence IDs. Never invent one; use `evidenceIds: []`
  if you have no real evidence.
- `control:verify` fails on any applied-state claim in a migration comment.
  `expected_migration` in `ENVIRONMENTS.yaml` is the only authority on what has run.

**The approval gate.** Capabilities with empty `scopes` are operator-only
(`apps/api/src/auth.ts:147`). `requiresApproval` capabilities create an approvals
row and never reach a handler. `apps/api/src/dispatch.ts` is the only place a held
action executes. Pre-approval gates live in `pipeline.ts`, so an operator is never
shown an approval the dispatcher will refuse.

**Determinism.** Same descriptor + template → byte-identical HTML and the same
sha256. Publishing promotes exactly the approved build. Do not break it.

**Sourcing.** Every displayed fact needs a source URL or an explicit
`ownerProvided` marker. `dossier.ts` blocks `unsourced`, `conflicting` and
`malformed` facts. `renderSection` only emits fields the template declares.

**Honest degradation.** Capabilities whose tables are missing report
`schema_pending` and change nothing. A failed publish records `queued` with the
provider's reason rather than claiming an address. An unreadable fingerprint
records `unreadable`, never a match. Keep this pattern — it is what made every
defect in this codebase findable.

## Key files

| Area | Path |
|---|---|
| Registry | `packages/registry/registry.ts`, `metadata.ts`, `codegen.ts` |
| Auth / approval | `apps/api/src/auth.ts`, `dispatch.ts`, `pipeline.ts`, `policy.ts` |
| Factory | `apps/api/src/factory/` — `dossier.ts`, `templates.ts`, `render.ts`, `qa.ts`, `publish.ts`, `fingerprint.ts`, `sweep.ts`, `hosting.ts`, `cloudflare-pages.ts` |
| Revenue rules | `apps/api/src/revenue/` — `qualification.ts`, `demo-queue.ts`, `sequence.ts`, `offers.ts`, `hosting-activation.ts`, `funnel.ts` |
| Handlers | `apps/api/src/handlers/` — `status.ts`, `prospecting.ts`, `sequence.ts`, `offers.ts`, `analytics.ts`, `verify-live.ts` |
| UI | `apps/os/src/MissionControl.tsx`, `FunnelCard.tsx`, `SiteBuilderCard.tsx`, `QaVerdict.tsx` |
| Control plane | `packages/control-schema/src/` — `verify-static.ts`, `migration-banner.ts`, `create-handoff.ts` |
| Migrations | `supabase/migrations/` (through `0010_deployment_unpublished.sql`, all applied) |

## Commands

```bash
pnpm build && pnpm lint && pnpm test && pnpm control:verify
```

Others: `pnpm control:status` (live drift; prefix with `railway run --service api`
for database credentials), `pnpm control:handoff -- --id <slug> --actor Claude
--work-item <ID> --objective ... --next ... --definition-of-done ...`,
`pnpm control:archive-handoff`.

## Verification discipline — this matters more than speed

- **Check exit codes, never grep for a success word.** `cmd | grep X || echo CLEAN`
  prints CLEAN when the command *crashes*. `$?` after a pipe is the *last*
  command's status, not the one you care about — this was got wrong in a real
  session and produced a confident, false "clean".
- **Mutation-test every guard you add.** Deliberately break it, confirm tests fail,
  restore. A guard with no failing mutation is decoration.
- **A test double cannot catch bad SQL.** `FakeDb` records statements without
  parsing them. Any statement touching the schema needs a transactional dry run
  (`begin … rollback`) against the real database before it ships. A read-back
  shipped with an uncast parameter and failed in production with `42P08` while
  every unit test passed.
- **A test written from the same assumption as the code proves nothing.** The Pages
  adapter asserted the same wrong request shape it sent, so nineteen passing tests
  confirmed only that the author's misunderstanding was self-consistent. No site
  had ever published.
- **Anything crossing a CDN must settle before you believe it.** A fingerprint
  read-back that ran immediately after publishing hashed the provider's placeholder
  and recorded a false mismatch.
- **Lint runs after build in CI** — type-aware `typescript-eslint` needs workspace
  `.d.ts` files. Do not reorder. Never run `eslint --fix` blindly; it has twice
  removed type assertions the build needs.
- **Green CI on a PR does not prove main will be green.** Always confirm the run on
  the exact merged main SHA.

### Merge with a merge commit, never squash — read this before you merge

```bash
gh pr merge <n> --merge
```

`control:verify` requires the handoff's recorded code-boundary commit to **exist**
and to be an **ancestor of HEAD**. The intended loop puts that boundary on a branch
commit: commit the work, then regenerate the handoff.

A merge commit keeps those branch commits in main's history, so the boundary stays
an ancestor. A squash merge replays the content as one new commit and leaves the
original outside main's ancestry, so verify fails on main with
`control.handoff_commit_not_ancestor`. Do not pass `--delete-branch` either; the
repo keeps merged branches and a deleted branch turns the same failure into
`control.handoff_commit_missing`.

Two more mechanics that cost time in a real session:

- **Commit on a branch, not on local `main`.** Committing to main then pushing fails
  on branch protection and leaves commits to move by hand.
- `origin`'s fetch refspec only tracks `main`, so `git push -u origin <branch>`
  creates no remote-tracking ref and `gh pr create` needs `--head <branch>`.

If main is already red on ancestry, rotate the handoff on a branch off main so the
boundary is a commit main already contains, then merge that with `--merge`.

## Live environment

| Thing | Value |
|---|---|
| Mission Control | `https://os-production-8faf.up.railway.app` |
| API | Railway service `api`, deploys from main |
| Published sites | `https://sites.andtronai.com/<slug>` (Cloudflare Pages) |
| Auth | Supabase, ES256 via JWKS, HS256 fallback |
| Cloudflare | account `fd486ea72e20f31937e059f3d14ff0c2`, zone `andtronai.com` = `9613c75aac8b84c6af05c19d9edc4aab` |

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

- **Mission Control's password is not available to you** and is not recoverable
  through the user. If work needs a signed-in session, verify a different way —
  served bundle contents, API responses, isolated component rendering — and say
  plainly what you could not check.
- **Direct database access may be refused** by the permission layer. Migrations are
  written for review, the operator applies them, and you then pin
  `expected_migration` plus `ATLAS_SCHEMA_VERSION` and verify through
  `control:status`.
- **The Cloudflare API token is Pages-scoped.** It cannot read or write zone
  settings (`403` / `10000`), and no API token can reach bot management on this
  free-plan zone. Zone changes need the dashboard.
- MCP servers `cloudflare-bindings`, `cloudflare-builds`,
  `cloudflare-observability` are unauthorised; not blocking.

## Autonomy granted

The user has authorised working autonomously: branch, implement, test, open a PR,
merge on green CI, and deploy without asking. Confirm before anything genuinely
irreversible or outward-facing — publishing to the live domain, sending real
outreach, destructive database changes, spending money, or changing account or
zone settings.

## Known gaps and open decisions

None of these blocks the active work item.

- **A directory adapter for lead sourcing.** This is what blocks the pilot's exit
  criterion — one real hosting-paying customer. It is an integration decision
  (provider terms, data licensing), not code.
- **A model credential** for `playbooks.author`, without which it records the
  operator's brief rather than running a frontier session.
- **Promoting `agents.logs`** from candidate — evidence-gated.
- **Closed.** `ENVIRONMENTS.yaml` now has a required `hosting` section, and the
  collector compares it against what the running API is configured with — five
  blocking detectors where there were none. Unobserved hosting reports unknown
  rather than a mismatch against nothing.
- **P2B's timed acceptance** needs an operator session.
- **Closed.** The full factory loop was run end to end against production on
  2026-08-04 — publish → revise → publish v2 → roll back → withdraw. It found
  that no site could ever be published twice: the live step-down ran after the
  insert, so the one-live index rejected it first. Fixed. Nothing is left live.
- **Closed.** The post-publish read-back budget was widened: the gap now
  doubles from two seconds capped at sixteen, seven reads over about sixty-two
  seconds, so a first publish no longer records a false mismatch.

## How the user wants you to work

Read the memory directory — it holds standing corrections. In particular: do not
build proof-of-concept scripts or demonstrations that were not asked for. Do the
requested scope, finish it completely, and report honestly including what failed or
was skipped.

One pattern is worth carrying forward above all others. Nearly every defect found
in this codebase has been **a claim that nothing checked**: migration banners that
still said "NOT APPLIED" after running; a comment claiming one Pages project could
host many businesses when it could host exactly one; a handler map whose header
claimed completeness was "asserted in tests" that did not exist; `runs.execute`
silently answering deterministic capabilities with prose. When you find one, do not
reword the claim — make it checkable, and let the check fail first so you know it
works.

Start by reading the files listed above, then build the P2C operator surface.
