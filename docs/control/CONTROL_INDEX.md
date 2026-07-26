# Atlas Control Index

## Five-minute orientation

Every indexed repository file path MUST be backticked and prefixed with
**path:**. The content after that prefix is a repository-root-relative path.
Other code spans are commands or identifiers and are not interpreted as paths.

1. Product doctrine: `path:docs/control/PRODUCT_DIRECTION.md`
2. Phase definitions: `path:docs/control/ROADMAP.md`
3. Active work: `path:docs/control/CURRENT_HANDOFF.md`
4. Machine work queue: `path:docs/control/WORK_QUEUE.yaml`
5. Environment inventory: `path:docs/control/ENVIRONMENTS.yaml`
6. Generated observed state and drift: run `pnpm control:status` to refresh the
   uncommitted files in `docs/control/generated/`; absence means no live refresh
   has been performed in this worktree
7. Research evidence: `path:docs/control/RESEARCH_LEDGER.yaml`
8. Staged non-executable capabilities: `path:docs/control/CAPABILITY_CANDIDATES.yaml`
9. Retained research artifact hashes: `path:docs/control/research/ARTIFACT_MANIFEST.yaml`

## Current phase

P1 code is complete. P1 production API deployment closure is blocking. P2A follows.

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
