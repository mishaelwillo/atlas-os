# Atlas Control Index

## Five-minute orientation

1. Product doctrine: `PRODUCT_DIRECTION.md`
2. Phase definitions: `ROADMAP.md`
3. Active work: `CURRENT_HANDOFF.md`
4. Machine work queue: `WORK_QUEUE.yaml`
5. Environment inventory: `ENVIRONMENTS.yaml`
6. Generated observed state and drift: unavailable until Continuity Task 4 installs the collector

## Current phase

P1 code is complete. P1 production API deployment closure is blocking. P2A follows.

## Authority

- Direction: product doctrine + ADRs
- Code: Git commit
- Capabilities: `packages/registry/registry.ts`
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
