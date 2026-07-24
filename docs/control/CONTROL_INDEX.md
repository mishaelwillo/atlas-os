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
6. Generated observed state and drift: unavailable until Continuity Task 4 installs the collector

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
- Start a handoff: `pnpm control:handoff -- --id <id> --objective "<objective>" --next "<next action>"`
- Archive a handoff: `pnpm control:archive-handoff`
