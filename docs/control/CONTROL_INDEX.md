# Atlas Control Index

## Five-minute orientation

Every indexed repository file path MUST be backticked and prefixed with
**path:**. The content after that prefix is a repository-root-relative path.
Other code spans are commands or identifiers and are not interpreted as paths.

1. Conceptual manual: `path:docs/MANUAL.md`
2. Product doctrine: `path:docs/control/PRODUCT_DIRECTION.md`
3. Phase definitions: `path:docs/control/ROADMAP.md`
4. Active work: `path:docs/control/CURRENT_HANDOFF.md`
5. Machine work queue: `path:docs/control/WORK_QUEUE.yaml`
6. Environment inventory: `path:docs/control/ENVIRONMENTS.yaml`
7. Generated observed state and drift: run `pnpm control:status` to refresh the
   uncommitted files in `docs/control/generated/`; absence means no live refresh
   has been performed in this worktree
8. Research evidence: `path:docs/control/RESEARCH_LEDGER.yaml`
9. Staged non-executable capabilities: `path:docs/control/CAPABILITY_CANDIDATES.yaml`
10. Retained research artifact hashes: `path:docs/control/research/ARTIFACT_MANIFEST.yaml`
11. P2 specification index: `path:docs/specs/p2/README.md`
12. Regional behavior: `path:docs/specs/p2/regional-packs.md`
13. Intelligence foundation: `path:docs/specs/p2/intelligence-foundation.md`
    (P2A↔P1 contract reconciliation:
    `path:docs/specs/p2/intelligence-reconciliation.md`)
14. Website Factory: `path:docs/specs/p2/website-factory.md`
15. Revenue pilot: `path:docs/specs/p2/revenue-pilot.md`
16. Recurring upsells: `path:docs/specs/p2/upsell-capabilities.md`
17. Presenter method playbook: `path:docs/specs/p2/presenter-workflow-playbook.md`
18. Observed menu crosswalk: `path:docs/specs/p2/menu-crosswalk.md`
19. Operator sign-in and Space selection:
    `path:docs/specs/p2/operator-sign-in.md`

## Current phase

P1 is complete and verified in production. P2A's build-now scope is done. P2B is
in review — the full publish loop is proven end to end against production and
only the timed operator acceptance remains. P2C is the active work: every
capability is built with an operator surface, and the whole pilot chain has been
driven through Mission Control. The exit criterion waits on a directory adapter
for real lead sourcing.

## Authority

- Direction: product doctrine + ADRs
- Code: Git commit
- Capabilities: `path:packages/registry/registry.ts`
- Database: migrations + live Supabase verification
- Hosting: Railway runtime fingerprint
- CI: GitHub Actions
- Active work: current handoff
- Research: research ledger

## Commands

- Refresh observed state: `pnpm control:status`
- Validate control plane: `pnpm control:verify`
- Start a handoff: `pnpm control:handoff -- --id <id> --objective "<objective>" --next "<next action>" [--task-change "<change>"] [--evidence "<check>"] [--database-action "<action>"] [--hosting-action "<action>"] [--side-effect "<effect>"] [--blocker "<blocker>"]`
- Archive a handoff: `pnpm control:archive-handoff`
