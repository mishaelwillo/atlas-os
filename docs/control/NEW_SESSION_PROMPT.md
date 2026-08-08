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

Main is `d2f52a1ad415438bed1211d7e681acf1e2299188` with Build & Test green on
that exact SHA. Both services deploy from main. Migrations `0001`–`0012` are
applied and pinned (`expected_migration: 0012_pilot_cost_and_outcome`, matched
by `ATLAS_SCHEMA_VERSION` on both services). **38 executable capabilities, 31
candidates**, registry version 3. `control:status` reports no blocking and no
warning findings.

- **P1 production** — done and verified live.
- **P2A Intelligence Bank** — build-now scope done.
- **P2B Website Factory** — **done**. The timed benchmark ran on 2026-08-06
  against a real, previously unseen business: 9m16s of a 30-minute budget from
  first opening a directory to an accessible preview, QA passing 28 checks with
  zero unsourced facts.
- **P2C Revenue pilot** — `in_progress`, and **everything it needs is built**.
  What remains is not code.

### The exit criterion has two halves, and both are now reachable

"One paying customer **and complete cost/support/outcome record**." The second
half had no implementation until 2026-08-07 — `funnel.ts` named six metrics as
unavailable because nothing recorded them, which meant even a paying customer
could not have closed the phase.

Migration `0012` adds `pilot_cost_entries` and `pilot_outcomes`;
`pilot.record_cost` and `pilot.record_outcome` write them; the funnel card
displays the record and carries the form. `time_per_stage` and days-to-activation
are derived from timestamps rather than recorded.

### Live pilot state, read from production

Two real hand-sourced prospects in the `atlas` space, both `eligibility_review`:

| prospect | total | remaining unknowns |
| --- | --- | --- |
| Xpert Plumbing & Maintenance Services | 26/30 | location |
| Patrick's Plumbing Service | 25/30 | operating status, location |

Demo queue, sequences, offers, entitlements, cost entries and outcomes are all
zero. **`messages` is empty — nothing has reached either business.** Eleven
sites exist from factory runs; no live deployment remains.

The old `Atlas Pilot Fixture Plumbing` fixture was removed on 2026-08-06 with an
audited script; its 16 audit rows and 2 approvals were deliberately kept.

## Known gaps and open decisions

Nothing on this list blocks on code you would write first.

- **Xpert needs one question answered on a phone call:** where are they based.
  That closes `identity_unverified` and takes it to `qualified`, which unlocks a
  demo slot. Its website is dead — the host's whole domain no longer resolves —
  so the call has its own reason to happen.
- **Patrick's needs the same call** to establish whether the business is
  trading. Every directory carrying it republishes one listing, and it has no
  Google Business Profile. Do not spend a demo slot there first.
- **A directory adapter** for `leads.find`, which is still a typed stub that
  throws. It buys volume; hand sourcing through `leads.record` is the documented
  pilot workflow and is what the two prospects came through. Note the licensing
  shape the terms review established: a source whose terms forbid commercial use
  is now a *blocker* in the rubric, not a question.
- **Promoting `agents.logs`** from candidate — evidence-gated, and the weakest
  evidence on the board (`confidence: low`, frames do not show the sub-tab).
- **Whether a service-area trade needs a verified location at all.** The rubric
  pairs `identityVerified && locationVerified` and a mobile plumber has no
  premises. The rule may be wrong for that class, but relaxing it while it
  blocks a wanted prospect is the wrong reason to change it.
- **Four capabilities still throw:** `memory.answer`, `memory.distill` (the
  token ladder, deferred from P1), `leads.find`, and `bench.run` — whose stub
  says "lands in P2". `memory.answer` and `memory.distill` are the only two
  `execution: 'model'` capabilities, so the model router currently has no
  working consumer. Setting `ATLAS_MODEL_API_KEY` alone changes nothing.

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
  fail, restore. A guard with no failing mutation is decoration. On 2026-08-07
  this caught three of the author's own tests in one session: one asserting
  "something blocks" where a different finding was blocking anyway, one
  exercising a router guard in conditions where the router would not have been
  called, and a dry run that checked a ledger row existed without checking the
  identity it composed to. All three passed while proving nothing.
- **Verify a form submission by reading back what was stored.** The assess form
  twice accepted values that never reached the API — once a fact count arrived
  as `0` and fired a spurious unknown, once a whole evidence set would have been
  wiped. The form accepts the submission and the rubric scores whatever it was
  actually handed; nothing in between notices a field that never arrived.
- **Do not suppress a lint that is right.** A `rules-of-hooks` suppression was
  added and then removed the same day: React counts hooks per render, so hooks
  after an early return are a real bug. The fix is moving them, plus a test that
  rerenders across both branches.
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
  themselves. Once they have, navigating a tab in the same Chrome profile picks
  the session up. Drive it through the Claude in Chrome tools — but **the
  `form_input` tool does not reach React state for text inputs**: values set
  that way vanish on the next 5-second poll and the submit silently sends
  nothing. Click the field and use `computer` `type` instead, and screenshot to
  confirm before submitting. `form_input` does work for `<select>`.
- **Direct database access works through `railway run --service api`**, which
  injects `DATABASE_URL`. Scripts must live under `apps/api` for `pg` to
  resolve — pnpm does not hoist. Migrations are still written for operator
  review; after they apply one you pin `expected_migration`, add any new tables
  to `required_tables`, set `ATLAS_SCHEMA_VERSION` on both services, redeploy so
  the value takes effect, and verify through `control:status`.
- **A migration's ledger `name` carries no version prefix.** The collector
  composes identity as `version + '_' + name`, so `0012` writing
  `'0012_pilot_cost_and_outcome'` produced `0012_0012_…` and blocking drift
  against a migration that had applied perfectly well.
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
