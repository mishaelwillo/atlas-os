# Atlas OS — new session prompt

Paste everything below the line into a new chat in this project.

---

Continue building **Atlas OS**. Do not re-do discovery — this prompt plus the
repo's own control plane is your starting state.

## Read these first, in this order

1. `AGENTS.md` — how to work in this repo
2. `docs/control/CONTROL_INDEX.md` — what the control plane is and its authorities
3. `docs/control/CURRENT_HANDOFF.md` — the active work item and next exact action
4. `docs/control/CURRENT_STATE.md` — observed reality
5. `docs/control/WORK_QUEUE.yaml` — phase status
6. `docs/specs/p2/website-factory.md` — the spec that owns the current work item

## Working directory

`C:\Users\misha\Documents\BizFramworkCap\atlas-source` — repo `mishaelwillo/atlas-os`.
Windows 11, PowerShell primary, Bash tool available. `pnpm` is installed globally
via npm (corepack fails with EPERM on this machine — do not try to enable it).

## Where the build stands

Main is `128980e66083d3ed3916efb0c11d88959c7c681c` with Build & Test green on that
exact SHA. Both services deploy from main.

- **P1 production** — done and verified live. Two approvals dispatched, `messages`
  empty, no outbound without `approved_by`.
- **P2A Intelligence Bank** — build-now scope done.
- **P2B Website Factory** — `in_progress`. This is the active work.
- **P2C Revenue pilot** — `ready`, blocked on P2B.

The factory chain works end to end from the product: enter sourced facts →
descriptor → deterministic render → approve → build re-verified against the
descriptor → uploaded to Cloudflare Pages → live at `sites.andtronai.com/<slug>`.

### The active work item

`P2B-FACTORY-001`. The handoff's next exact action is:

> Implement accessibility, responsive, link and structured-data checks that must
> pass before a site can be approved for publish.

Definition of done: **a build that fails any QA check cannot reach an approved
publish.** The spec requires this at `docs/specs/p2/website-factory.md` — see the
`qa_result` table in the data model, the `qa_failed` state in the generation state
machine, and the acceptance test "Required accessibility, responsive, link,
structured-data, privacy, security, and performance checks pass before approval."

This is the last build-now item in P2B and needs nothing from the user.

## Architecture you must respect

**The capability registry is the single source of truth.** `packages/registry/registry.ts`
generates `apps/api/src/routes.gen.ts` and `packages/client/src/client.gen.ts`.
A capability not in the registry does not exist. Never hand-wire a route.

**Governance tripwires will block you if you drift:**

- `specifications.ts` pins the exact executable capability count — adding a
  capability without updating it fails the gate.
- `capabilityMetadata` requires lifecycle + owner spec for every capability.
- The research ledger validates evidence IDs. Never invent one; use `evidenceIds: []`
  if you have no real evidence.

**The approval gate.** Capabilities with empty `scopes` are operator-only
(`apps/api/src/auth.ts:147`). `requiresApproval` capabilities create an approvals
row and never reach a handler. `apps/api/src/dispatch.ts` is the only place a held
action executes.

**Determinism.** Same descriptor + template → byte-identical HTML and the same
sha256. This is what lets publish serve exactly the approved build. Do not break it.

**Sourcing.** Every displayed fact needs a source URL or an explicit
`ownerProvided` marker. `dossier.ts` blocks `unsourced`, `conflicting`, and
`malformed` facts. `renderSection` only emits fields the template declares.

## Key files

| Area | Path |
|---|---|
| Registry | `packages/registry/registry.ts`, `codegen.ts` |
| Auth / approval | `apps/api/src/auth.ts`, `dispatch.ts`, `policy.ts` |
| Factory | `apps/api/src/factory/` — `dossier.ts`, `templates.ts`, `render.ts`, `publish.ts`, `hosting.ts`, `cloudflare-pages.ts` |
| Status cards | `apps/api/src/handlers/status.ts` |
| UI | `apps/os/src/MissionControl.tsx`, `SiteBuilderCard.tsx`, `SitesCard.tsx`, `session.ts` |
| Control plane | `packages/control-schema/src/` — `verify-static.ts`, `create-handoff.ts`, `archive-handoff.ts` |
| Migrations | `supabase/migrations/` (through `0003_site_deployments.sql`, all applied) |

## Commands

```bash
pnpm build && pnpm lint && pnpm test && pnpm control:verify
```

Others: `pnpm control:status` (live drift), `pnpm control:handoff -- --id <slug> --actor Claude --work-item <ID> --objective ... --next ... --definition-of-done ...`, `pnpm control:archive-handoff`.

## Verification discipline — this matters more than speed

- **Check exit codes, never grep for a success word.** `cmd | grep X || echo CLEAN`
  prints CLEAN when the command *crashes*. Run the command, capture `$?`, then
  inspect. ANSI colour codes also break naive greps, and a failed grep in an `&&`
  chain silently skips everything after it.
- **Mutation-test every guard you add.** Deliberately break it, confirm tests fail,
  restore. A guard with no failing mutation is decoration.
- **Lint runs after build in CI** — type-aware `typescript-eslint` needs workspace
  `.d.ts` files. Do not reorder.
- **Never run `eslint --fix` blindly.** It has twice removed type assertions that
  the build needs.
- **Green CI on a PR does not prove main will be green.** Always confirm the run on
  the exact merged main SHA.

### Never delete a merged branch — read this before you merge

`control:verify` requires the handoff's recorded code-boundary commit to exist and
be an ancestor of HEAD. The intended loop puts that boundary on a *branch* commit
(commit the work, then regenerate the handoff), and a squash merge does not replay
that commit onto main.

It works anyway because CI checks out with `fetch-depth: 0` and **this repo keeps
merged branches** — 30+ are retained on the remote, so the boundary commit stays
reachable.

Deleting the branch removes the only ref holding that commit and main goes red with
`control.handoff_commit_missing`. This happened on 2026-08-02: `--delete-branch` on
PR #34 broke main, while PR #33 and everything before it were fine.

**Merge with `gh pr merge <n> --squash` and do not pass `--delete-branch`.** If a
branch was already deleted, rotate the handoff on a follow-up branch so the
boundary points at a commit on main.

## Live environment

| Thing | Value |
|---|---|
| Mission Control | `https://os-production-8faf.up.railway.app` |
| API | Railway service `api`, deploys from main |
| Published sites | `https://sites.andtronai.com/<slug>` (Cloudflare Pages) |
| Auth | Supabase, ES256 via JWKS, HS256 fallback |
| Domain | `andtronai.com` on Cloudflare |

Env var names (values are set in Railway, do not print them): `DATABASE_URL`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`,
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_PAGES_PROJECT`,
`ATLAS_SITES_BASE_URL`, `ATLAS_SITES_LAYOUT`, `ATLAS_OUTREACH_DAILY_CAP`,
`ATLAS_CHAIN_THINK|DO|QUICK`, `ATLAS_MODEL_API_KEY`, `ATLAS_MODEL_BASE_URL`,
`ATLAS_SCHEMA_VERSION`, `ATLAS_GIT_SHA`, `ATLAS_BUILD_TIME`, `ATLAS_CONTROL_LIVE`.

**Do not pin `ATLAS_GIT_SHA` to a fixed value** — it was removed deliberately so
fingerprints cannot go permanently stale.

## Autonomy granted

The user has authorized working autonomously: branch, implement, test, open a PR,
merge on green CI, and deploy without asking. Confirm before anything genuinely
irreversible or outward-facing (sending real outreach to real people, destructive
DB changes, spending money).

**The user cannot be asked for the Mission Control password** — you have never had
it and it is not recoverable through you. If a task needs a signed-in browser
session, verify a different way (served bundle contents, API responses, isolated
component rendering) and say plainly what you could not check.

## After P2B closes

Remaining P2C build-now scope: prospect qualification, demo queue, sequence state,
offers/terms, hosting activation state, funnel analytics.

Known gaps and open decisions:

- `ENVIRONMENTS.yaml` holds hosting config as prose only, so hosting drift is
  currently undetected. Extending the schema is real work worth doing.
- Model credential for the `playbooks.author` frontier session — undecided.
- `agents.logs` promotion — evidence-gated, undecided.
- Directory adapter for lead sourcing — undecided.
- MCP servers `cloudflare-bindings`, `cloudflare-builds`, `cloudflare-observability`
  are unauthorized. They need OAuth in an interactive session; not blocking.

## How the user wants you to work

Read the memory directory — it holds standing corrections. In particular: do not
build proof-of-concept scripts or demonstrations that were not asked for. Do the
requested scope, finish it completely, and report honestly including what failed
or was skipped.

Start by reading the files listed above, then implement the QA gate.
