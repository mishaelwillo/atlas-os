# Atlas Model Entry Point

Before changing Atlas:

1. Read `docs/control/CONTROL_INDEX.md`.
2. Read `docs/control/CURRENT_HANDOFF.md`.
3. Run `pnpm control:status`.
4. Stop on any blocking drift.
5. Read only the active specification and its linked evidence.
6. Confirm the active work item and branch.

Before stopping:

1. Run the task's tests.
2. Run `pnpm control:verify`.
3. Update `docs/control/CURRENT_HANDOFF.md`.
4. Record external writes and the next exact action.
5. After merging, on the integration branch, run `pnpm control:archive-handoff`.
   An active handoff naming a merged branch blocks `control:verify` for the next
   session, which then opens on a finding that means nothing.

Never put tokens, passwords, private keys, connection strings, or secret values in control artifacts.
